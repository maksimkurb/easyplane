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

/** Policy mode: open (no ACL pushed), rules (structured editor) or json. */
export const policyModeEnum = pgEnum("policy_mode", ["open", "rules", "json"]);

/** Where a user group's membership comes from. */
export const userGroupSourceEnum = pgEnum("user_group_source", ["manual", "oidc"]);

/** A device joins as `pending`, gets approved, or is blocked. */
export const deviceStateEnum = pgEnum("device_state", [
  "pending",
  "approved",
  "blocked",
]);

/** How devices authenticate to the EasyTier network (see docs/CREDENTIALS.md). */
export const networkAccessModeEnum = pgEnum("network_access_mode", [
  "shared_secret",
  "credentials",
]);

/**
 * Device role in a credentials network. In `shared_secret` mode every device
 * effectively holds the secret, so its role is informational (`anchor`).
 */
export const deviceRoleEnum = pgEnum("device_role", ["anchor", "member"]);

/** Lifecycle of a per-device EasyTier credential. */
export const credentialStatusEnum = pgEnum("credential_status", [
  "active",
  "revoked",
  "expired",
]);

/** Where a config revision came from. */
export const revisionSourceEnum = pgEnum("revision_source", [
  "approval",
  "manual",
  "rollback",
  /** Created automatically when the network policy document changed. */
  "policy",
]);

/** A route a device asks to serve (subnet proxy) or be (exit node). */
export const deviceRouteKindEnum = pgEnum("device_route_kind", [
  "subnet",
  "exit_node",
]);

/** Route requests are pending until an admin approves or rejects them. */
export const deviceRouteStateEnum = pgEnum("device_route_state", [
  "pending",
  "approved",
  "rejected",
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
    /**
     * IdP groups from the last OIDC login. Policy `group:<name>` subjects
     * expand to the devices owned by the matching users.
     */
    groups: text("groups").array().notNull().default(sql`'{}'::text[]`),
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
    /**
     * How devices authenticate. `shared_secret` (default): every device knows
     * the secret. `credentials`: anchors hold the secret and publish trusted
     * device keys; members join with a per-device, revocable credential.
     */
    accessMode: networkAccessModeEnum("access_mode")
      .notNull()
      .default("shared_secret"),
    /** IPv4 CIDR the control plane allocates device addresses from. */
    ipv4Cidr: text("ipv4_cidr").notNull().default("10.144.144.0/24"),
    /** Per-network MagicDNS switch (pushed as `enable_magic_dns`). */
    magicDnsEnabled: boolean("magic_dns_enabled").notNull().default(false),
    /**
     * DNS zone used for generated names. EasyTier keeps the zone in its local
     * flags (`--tld-dns-zone`), not in NetworkConfig, so the value is also
     * shown to operators as a client-side requirement.
     */
    magicDnsZone: text("magic_dns_zone").notNull().default("et.net."),
    /** Latest policy document version (0 = no policy, traffic unrestricted). */
    policyVersion: integer("policy_version").notNull().default(0),
    /**
     * Access editor mode. `open` pushes no ACL at all (EasyTier's filter is
     * off); `rules` and `json` are the same document edited structurally or as
     * HuJSON. The document is kept across an `open` switch, so toggling back
     * does not lose rules.
     */
    policyMode: policyModeEnum("policy_mode").notNull().default("open"),
    /**
     * Network-level opt-in for the bundled rendezvous node. When on, the
     * configured `EASYPLANE_RENDEZVOUS_ENDPOINTS` are appended to every
     * device's compiled peer list and devices are pushed with secure mode
     * (required for the node's private-mode shared-secret proof).
     */
    useRendezvous: boolean("use_rendezvous").notNull().default(false),
    /**
     * Push `p2p_only` to every device in this network. Advanced: devices then
     * only talk to peers they have a direct connection with, so NAT
     * combinations that need a relay cannot connect at all.
     */
    p2pOnly: boolean("p2p_only").notNull().default(false),
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
    /**
     * Role a newly enrolled device gets. In a credentials network the first
     * device must be an anchor; later invites usually are members.
     */
    role: deviceRoleEnum("role").notNull().default("anchor"),
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
    role: deviceRoleEnum("role").notNull().default("anchor"),
    inviteId: uuid("invite_id").references(() => invites.id, {
      onDelete: "set null",
    }),
    /** Address reserved for this device in the network CIDR. */
    virtualIpv4: text("virtual_ipv4"),
    /**
     * Unique, DNS-safe hostname inside the network. Authoritative for the
     * EasyTier `hostname` pushed to the client and for MagicDNS names.
     */
    dnsName: text("dns_name"),
    /** Member/admin account that owns the device (policy `group:` subjects). */
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Peer URLs other devices may dial to reach this one (`tcp://host:11010`,
     * `udp://`, `ws://`, `wss://`, `quic://`, `wg://`, `ring://`, ...).
     * Advertised explicitly instead of being guessed from an IP or hostname.
     */
    advertisedEndpoints: text("advertised_endpoints")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Port EasyTier listens on when the device is a hub. Null means the
     * default 11010 (both tcp and udp are bound on it).
     */
    listenPort: integer("listen_port"),
    /**
     * Port other devices dial after router port-forwarding. Null means "same
     * as the listen port"; the public address is the device's STUN-reported
     * IPv4 plus this port.
     */
    externalPort: integer("external_port"),
    /**
     * Last public IPv4 addresses the topology collector observed for this
     * device (EasyTier STUN). Kept when the device goes offline so an
     * advertised hub endpoint does not disappear between probes.
     */
    publicIps: text("public_ips")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * A hub is a device other devices dial. Only approved hubs contribute
     * endpoints to a network's compiled peer list, and a hub never receives
     * its own endpoints (so it cannot dial itself).
     */
    isHub: boolean("is_hub").notNull().default(false),
    /**
     * Last route report collected from the client: instances it runs, proxy
     * CIDRs it advertises, and which of those were not approved here.
     */
    reportedState: jsonb("reported_state")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    reportedStateAt: timestamp("reported_state_at", { withTimezone: true }),
    /** Latest desired config revision number (null until approved). */
    desiredRevision: integer("desired_revision"),
    /** Revision the client last confirmed running. */
    appliedRevision: integer("applied_revision"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /**
     * Set after the first push that carries the explicit
     * `enable_manual_routes` list. Null means "not enforced yet": the push
     * engine forces one convergence so the security fix reaches devices that
     * are already in sync (the pinned client cannot report an empty manual
     * list, so drift comparison alone would never notice).
     */
    manualRoutesEnforcedAt: timestamp("manual_routes_enforced_at", {
      withTimezone: true,
    }),
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
    /**
     * MagicDNS names are unique per network, case-insensitively. The service
     * also checks before writing so the API returns a clear 409.
     */
    uniqueIndex("devices_network_dns_name_uq").on(
      table.networkId,
      sql`lower(${table.dnsName})`,
    ),
    index("devices_state_idx").on(table.state),
    index("devices_org_idx").on(table.orgId),
  ],
);

/**
 * A network's ordered peer list. An entry is either a reference to a panel
 * device (device-backed, `url` is null) whose advertised endpoints are dialled
 * by every *other* device, or a raw external peer URL (`url` set). A raw URL
 * may carry an optional `device_id` link: it is still pushed to everyone else
 * but skipped for that device, so a legacy per-device URL cannot make the owner
 * dial itself.
 */
export const networkPeers = pgTable(
  "network_peers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    /** Device-backed entry (and optional link for a raw URL). */
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    /** Raw external peer URL; null when the entry is device-backed. */
    url: text("url"),
    /** Ordering inside the peer list; compacted by the service on writes. */
    position: integer("position").notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
  },
  (table) => [
    uniqueIndex("network_peers_position_uq").on(table.networkId, table.position),
    uniqueIndex("network_peers_device_uq")
      .on(table.networkId, table.deviceId)
      .where(sql`${table.url} IS NULL`),
    uniqueIndex("network_peers_raw_uq")
      .on(table.networkId, table.url)
      .where(sql`${table.url} IS NOT NULL`),
    index("network_peers_network_idx").on(table.networkId),
  ],
);

/**
 * Append-only policy document versions. The active version is
 * `networks.policy_version`; nothing is ever overwritten, so a config revision
 * can name the policy version it was compiled with.
 */
export const networkPolicies = pgTable(
  "network_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Validated, normalised policy document (never contains secrets). */
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
  },
  (table) => [
    uniqueIndex("network_policies_network_version_uq").on(
      table.networkId,
      table.version,
    ),
  ],
);

/**
 * Subnet/exit-node route requests. Only `approved` rows are compiled into the
 * pushed config; `pending` and `rejected` rows exist for the approval workflow.
 */
export const deviceRoutes = pgTable(
  "device_routes",
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
    kind: deviceRouteKindEnum("kind").notNull(),
    /** IPv4 CIDR for `subnet`; empty string for `exit_node`. */
    cidr: text("cidr").notNull().default(""),
    state: deviceRouteStateEnum("state").notNull().default("pending"),
    /**
     * Who asked for the route: `panel` (a member/admin requested it on the
     * device's behalf) or `device_declared` (the device's own persisted config
     * advertises it; docs/POLICY.md §7.1).
     */
    source: text("source").$type<"panel" | "device_declared">().notNull().default("panel"),
    /**
     * Last report that showed a `device_declared` route in the device's own
     * config. Older than the advertised window means "no longer advertised".
     */
    lastDeclaredAt: timestamp("last_declared_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("device_routes_uq").on(table.deviceId, table.kind, table.cidr),
    index("device_routes_network_idx").on(table.networkId),
    index("device_routes_state_idx").on(table.state),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Namespaced name (`tag:web`), which is also the EasyTier group name. */
    name: text("name").notNull(),
    color: text("color").notNull().default(""),
    createdAt,
  },
  (table) => [uniqueIndex("tags_org_name_uq").on(table.orgId, table.name)],
);

/**
 * A group of people ("user groups"). Distinct from tags, which label devices.
 *
 * `manual` groups have explicit member emails; `oidc` groups mirror an identity
 * provider claim value and are read-only (their members are derived from
 * `users.groups` at read time, never stored).
 */
export const userGroups = pgTable(
  "user_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Bare name (`admins`); subjects are `group:admins`. */
    name: text("name").notNull(),
    source: userGroupSourceEnum("source").notNull().default("manual"),
    /** IdP claim value for a synced group (`source = oidc`). */
    oidcValue: text("oidc_value").notNull().default(""),
    color: text("color").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
  },
  (table) => [uniqueIndex("user_groups_org_name_uq").on(table.orgId, table.name)],
);

/** A manual user-group member (an email address). */
export const userGroupMembers = pgTable(
  "user_group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => userGroups.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("user_group_members_group_email_uq").on(table.groupId, table.email),
  ],
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
    /**
     * Policy document version this revision's compiled ACL was built from.
     * Route approvals and MagicDNS are network state, not revision content.
     */
    policyVersion: integer("policy_version"),
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

/**
 * A per-device EasyTier credential in a `credentials` network.
 *
 * The member never receives the network secret: it joins with the X25519
 * private key stored here (encrypted at rest, exactly like a network secret).
 * Anchors receive the same private key inside `managed_credentials` and
 * publish the derived public key over OSPF, so one row drives both sides.
 * Only the current row per device is kept; revoking marks it `revoked` (an
 * append-only audit trail lives in `audit_log`).
 */
export const credentials = pgTable(
  "credentials",
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
    /** EasyTier `credential_id` (a UUID string, also used by the client). */
    credentialId: text("credential_id").notNull(),
    /** AES-256-GCM ciphertext of `base64(X25519 private key)`. */
    secretCiphertext: text("secret_ciphertext").notNull(),
    /** `base64(X25519 public key)`; safe to display and audit. */
    publicKey: text("public_key").notNull(),
    /** EasyTier ACL group names granted to this member (our tags). */
    groups: text("groups").array().notNull().default(sql`'{}'::text[]`),
    /** Whether this member may relay traffic (`allow_relay`). */
    allowRelay: boolean("allow_relay").notNull().default(true),
    /** CIDRs the member may proxy (`allowed_proxy_cidrs`). */
    allowedProxyCidrs: text("allowed_proxy_cidrs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Whether several peers may use the same credential. */
    reusable: boolean("reusable").notNull().default(true),
    expiry: timestamp("expiry", { withTimezone: true }).notNull(),
    status: credentialStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedBy: uuid("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Why it was revoked (revoked, network switched to shared_secret, …). */
    revocationReason: text("revocation_reason").notNull().default(""),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("credentials_device_uq").on(table.deviceId),
    uniqueIndex("credentials_network_credential_uq").on(
      table.networkId,
      table.credentialId,
    ),
    index("credentials_network_status_idx").on(table.networkId, table.status),
    index("credentials_expiry_idx").on(table.expiry),
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
  peers: many(networkPeers),
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
  network: one(networks, {
    fields: [credentials.networkId],
    references: [networks.id],
  }),
  device: one(devices, {
    fields: [credentials.deviceId],
    references: [devices.id],
  }),
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
  peers: many(networkPeers),
}));

export const networkPeersRelations = relations(networkPeers, ({ one }) => ({
  network: one(networks, {
    fields: [networkPeers.networkId],
    references: [networks.id],
  }),
  device: one(devices, {
    fields: [networkPeers.deviceId],
    references: [devices.id],
  }),
}));

export type Organisation = typeof organisations.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserRole = User["role"];
export type Credential = typeof credentials.$inferSelect;
export type CredentialStatus = Credential["status"];
export type NetworkAccessMode = Network["accessMode"];
export type DeviceRole = Device["role"];
export type Network = typeof networks.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type DeviceState = Device["state"];
export type ConfigRevision = typeof configRevisions.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type NetworkPolicy = typeof networkPolicies.$inferSelect;
export type DeviceRoute = typeof deviceRoutes.$inferSelect;
export type DeviceRouteKind = DeviceRoute["kind"];
export type DeviceRouteState = DeviceRoute["state"];
export type NetworkPeer = typeof networkPeers.$inferSelect;
export type UserGroup = typeof userGroups.$inferSelect;
export type UserGroupMember = typeof userGroupMembers.$inferSelect;
