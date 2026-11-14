import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Roles are global to an organisation in M1 (one organisation per deployment). */
export const userRoleEnum = pgEnum("user_role", ["admin", "member", "viewer"]);

/** A device joins as `pending`, gets approved, or is blocked. */
export const deviceStateEnum = pgEnum("device_state", [
  "pending",
  "approved",
  "blocked",
]);

/** Where a config revision came from. */
export const revisionSourceEnum = pgEnum("revision_source", [
  "approval",
  "manual",
  "rollback",
]);

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull().default(""),
    role: userRoleEnum("role").notNull().default("viewer"),
    /** Created by the break-glass token rather than an OIDC identity. */
    bootstrap: boolean("bootstrap").notNull().default(false),
    disabled: boolean("disabled").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [uniqueIndex("users_org_email_uq").on(table.orgId, table.email)],
);

/** OIDC `(provider, subject)` -> local user. */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    email: text("email").notNull().default(""),
    createdAt,
  },
  (table) => [
    uniqueIndex("user_identities_provider_subject_uq").on(
      table.provider,
      table.subject,
    ),
    index("user_identities_user_idx").on(table.userId),
  ],
);

/** PG-backed browser sessions; only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    csrfToken: text("csrf_token").notNull(),
    ip: text("ip").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),
    createdAt,
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

/** Short-lived OIDC authorization-code state (PKCE verifier + nonce). */
export const oidcLoginStates = pgTable(
  "oidc_login_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull().unique(),
    provider: text("provider").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    nonce: text("nonce").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    returnTo: text("return_to").notNull().default("/"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [index("oidc_login_states_expires_idx").on(table.expiresAt)],
);

export const networks = pgTable(
  "networks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Human-facing display name. */
    name: text("name").notNull(),
    /** Server-generated EasyTier `network_name` (unique per deployment). */
    networkName: text("network_name").notNull().unique(),
    /** AES-256-GCM ciphertext of the EasyTier `network_secret`. */
    secretCiphertext: text("secret_ciphertext").notNull(),
    /** IPv4 CIDR the control plane allocates device addresses from. */
    ipv4Cidr: text("ipv4_cidr").notNull().default("10.144.144.0/24"),
    /** Non-secret defaults merged into every device's desired config. */
    defaultConfig: jsonb("default_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("networks_org_idx").on(table.orgId)],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    /** SHA-256 of the invite token; the plaintext is shown exactly once. */
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** null means unlimited uses (expiry still applies). */
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
  },
  (table) => [
    index("invites_network_idx").on(table.networkId),
    index("invites_org_idx").on(table.orgId),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    /** EasyTier `machine_id` (stable per host). */
    machineId: text("machine_id").notNull(),
    hostname: text("hostname").notNull().default(""),
    easytierVersion: text("easytier_version").notNull().default(""),
    osType: text("os_type").notNull().default(""),
    osVersion: text("os_version").notNull().default(""),
    osDistribution: text("os_distribution").notNull().default(""),
    sourceIp: text("source_ip").notNull().default(""),
    state: deviceStateEnum("state").notNull().default("pending"),
    inviteId: uuid("invite_id").references(() => invites.id, {
      onDelete: "set null",
    }),
    /** Address reserved for this device in the network CIDR. */
    virtualIpv4: text("virtual_ipv4"),
    /** Latest desired config revision number (null until approved). */
    desiredRevision: integer("desired_revision"),
    /** Revision the client last confirmed running. */
    appliedRevision: integer("applied_revision"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** Last push failure, cleared on a successful push. */
    lastPushError: text("last_push_error"),
    lastPushAt: timestamp("last_push_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedBy: uuid("blocked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("devices_network_machine_uq").on(
      table.networkId,
      table.machineId,
    ),
    uniqueIndex("devices_network_ip_uq").on(table.networkId, table.virtualIpv4),
    index("devices_state_idx").on(table.state),
    index("devices_org_idx").on(table.orgId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default(""),
    createdAt,
  },
  (table) => [uniqueIndex("tags_org_name_uq").on(table.orgId, table.name)],
);

/** Table only in M1; the tag editor lands in M2. */
export const deviceTags = pgTable(
  "device_tags",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    uniqueIndex("device_tags_uq").on(table.deviceId, table.tagId),
  ],
);

export const configRevisions = pgTable(
  "config_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    /** Non-secret NetworkConfig; the network secret lives only on `networks`. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    note: text("note").notNull().default(""),
    source: revisionSourceEnum("source").notNull().default("manual"),
    rollbackOfRevision: integer("rollback_of_revision"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
  },
  (table) => [
    uniqueIndex("config_revisions_device_revision_uq").on(
      table.deviceId,
      table.revision,
    ),
    index("config_revisions_network_idx").on(table.networkId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Null for device/system-driven events. */
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorType: text("actor_type").notNull().default("user"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull().default(""),
    targetId: text("target_id").notNull().default(""),
    /** Never contains secrets; enforced in the audit service. */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt,
  },
  (table) => [
    index("audit_log_created_idx").on(table.createdAt),
    index("audit_log_org_idx").on(table.orgId),
  ],
);

export const organisationsRelations = relations(organisations, ({ many }) => ({
  users: many(users),
  networks: many(networks),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [users.orgId],
    references: [organisations.id],
  }),
  identities: many(userIdentities),
  sessions: many(sessions),
}));

export const networksRelations = relations(networks, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [networks.orgId],
    references: [organisations.id],
  }),
  devices: many(devices),
  invites: many(invites),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  network: one(networks, {
    fields: [devices.networkId],
    references: [networks.id],
  }),
  invite: one(invites, {
    fields: [devices.inviteId],
    references: [invites.id],
  }),
  revisions: many(configRevisions),
}));

export type Organisation = typeof organisations.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserRole = User["role"];
export type Network = typeof networks.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type DeviceState = Device["state"];
export type ConfigRevision = typeof configRevisions.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
