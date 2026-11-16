import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  auditLog,
  configRevisions,
  credentials,
  deviceRoutes,
  deviceTags,
  devices,
  invites,
  networkPeers,
  networkPolicies,
  networks,
  oidcLoginStates,
  organisations,
  sessions,
  tags,
  userIdentities,
  users,
  type Device,
  type DeviceRoute,
  type DeviceRouteKind,
  type DeviceRouteState,
  type Credential,
  type DeviceState,
  type NetworkPeer,
  type User,
  type UserRole,
} from "./schema.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | Tx;

export interface SessionWithUser {
  session: typeof sessions.$inferSelect;
  user: User;
  organisation: typeof organisations.$inferSelect;
}

export async function ensureOrganisation(
  db: DbExecutor,
  input: { slug: string; name: string },
): Promise<typeof organisations.$inferSelect> {
  const existing = await db
    .select()
    .from(organisations)
    .where(eq(organisations.slug, input.slug))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(organisations)
    .values({ slug: input.slug, name: input.name })
    .onConflictDoNothing({ target: organisations.slug })
    .returning();
  if (inserted[0]) return inserted[0];
  const raced = await db
    .select()
    .from(organisations)
    .where(eq(organisations.slug, input.slug))
    .limit(1);
  if (!raced[0]) throw new Error("failed to create organisation");
  return raced[0];
}

export async function findUserById(
  db: DbExecutor,
  id: string,
): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function findUserByEmail(
  db: DbExecutor,
  orgId: string,
  email: string,
): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.email, email)))
    .limit(1);
  return rows[0];
}

export async function listUsers(db: DbExecutor, orgId: string): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(asc(users.createdAt));
}

export async function countAdmins(db: DbExecutor, orgId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.role, "admin"),
        eq(users.disabled, false),
      ),
    );
  return Number(rows[0]?.value ?? 0);
}

export async function insertUser(
  db: DbExecutor,
  values: {
    orgId: string;
    email: string;
    displayName?: string;
    role?: UserRole;
    bootstrap?: boolean;
    groups?: string[];
  },
): Promise<User> {
  const rows = await db
    .insert(users)
    .values({
      orgId: values.orgId,
      email: values.email,
      displayName: values.displayName ?? "",
      role: values.role ?? "viewer",
      bootstrap: values.bootstrap ?? false,
      groups: values.groups ?? [],
    })
    .returning();
  if (!rows[0]) throw new Error("failed to create user");
  return rows[0];
}

export async function updateUser(
  db: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      User,
      "displayName" | "role" | "lastLoginAt" | "disabled" | "bootstrap" | "groups"
    >
  >,
): Promise<User | undefined> {
  const rows = await db
    .update(users)
    .set(values)
    .where(eq(users.id, id))
    .returning();
  return rows[0];
}

export async function findIdentity(
  db: DbExecutor,
  provider: string,
  subject: string,
): Promise<typeof userIdentities.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, provider),
        eq(userIdentities.subject, subject),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertIdentity(
  db: DbExecutor,
  values: { userId: string; provider: string; subject: string; email: string },
): Promise<void> {
  await db.insert(userIdentities).values(values).onConflictDoNothing();
}

export async function createSession(
  db: DbExecutor,
  values: {
    userId: string;
    tokenHash: string;
    csrfToken: string;
    ip: string;
    userAgent: string;
    expiresAt: Date;
  },
): Promise<typeof sessions.$inferSelect> {
  const rows = await db.insert(sessions).values(values).returning();
  if (!rows[0]) throw new Error("failed to create session");
  return rows[0];
}

export async function findSession(
  db: DbExecutor,
  tokenHash: string,
): Promise<SessionWithUser | undefined> {
  const rows = await db
    .select({ session: sessions, user: users, organisation: organisations })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organisations, eq(organisations.id, users.orgId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function touchSession(
  db: DbExecutor,
  id: string,
  values: { lastSeenAt: Date; expiresAt: Date },
): Promise<void> {
  await db.update(sessions).set(values).where(eq(sessions.id, id));
}

export async function deleteSession(db: DbExecutor, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteUserSessions(
  db: DbExecutor,
  userId: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function pruneSessions(db: DbExecutor, now: Date): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function insertOidcLoginState(
  db: DbExecutor,
  values: {
    state: string;
    provider: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
    returnTo: string;
    expiresAt: Date;
  },
): Promise<void> {
  await db.insert(oidcLoginStates).values(values);
}

export async function consumeOidcLoginState(
  db: DbExecutor,
  state: string,
  now: Date,
): Promise<typeof oidcLoginStates.$inferSelect | null> {
  const rows = await db
    .delete(oidcLoginStates)
    .where(
      and(
        eq(oidcLoginStates.state, state),
        gt(oidcLoginStates.expiresAt, now),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function pruneOidcLoginStates(
  db: DbExecutor,
  now: Date,
): Promise<void> {
  await db.delete(oidcLoginStates).where(lt(oidcLoginStates.expiresAt, now));
}

export interface NetworkSummary {
  network: typeof networks.$inferSelect;
  deviceCount: number;
  pendingCount: number;
  onlineCount: number;
}

export async function insertNetwork(
  db: DbExecutor,
  values: {
    orgId: string;
    name: string;
    networkName: string;
    secretCiphertext: string;
    ipv4Cidr: string;
    defaultConfig: Record<string, unknown>;
    createdBy: string | null;
  },
): Promise<typeof networks.$inferSelect> {
  const rows = await db.insert(networks).values(values).returning();
  if (!rows[0]) throw new Error("failed to create network");
  return rows[0];
}

export async function listNetworks(
  db: DbExecutor,
  orgId: string,
): Promise<typeof networks.$inferSelect[]> {
  return db
    .select()
    .from(networks)
    .where(eq(networks.orgId, orgId))
    .orderBy(asc(networks.createdAt));
}

export async function getNetwork(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<typeof networks.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(networks)
    .where(and(eq(networks.orgId, orgId), eq(networks.id, id)))
    .limit(1);
  return rows[0];
}

export async function updateNetwork(
  db: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      typeof networks.$inferInsert,
      | "name"
      | "ipv4Cidr"
      | "defaultConfig"
      | "secretCiphertext"
      | "magicDnsEnabled"
      | "magicDnsZone"
      | "policyVersion"
      | "useRendezvous"
      | "p2pOnly"
      | "accessMode"
    >
  >,
): Promise<typeof networks.$inferSelect | undefined> {
  const rows = await db
    .update(networks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(networks.id, id))
    .returning();
  return rows[0];
}

export async function deleteNetwork(db: DbExecutor, id: string): Promise<void> {
  await db.delete(networks).where(eq(networks.id, id));
}

export async function networkDeviceCounts(
  db: DbExecutor,
  networkId: string,
): Promise<Record<DeviceState, number>> {
  const rows = await db
    .select({ state: devices.state, value: count() })
    .from(devices)
    .where(eq(devices.networkId, networkId))
    .groupBy(devices.state);
  const result: Record<DeviceState, number> = {
    pending: 0,
    approved: 0,
    blocked: 0,
  };
  for (const row of rows) result[row.state] = Number(row.value);
  return result;
}

export async function insertInvite(
  db: DbExecutor,
  values: {
    orgId: string;
    networkId: string;
    tokenHash: string;
    label: string;
    role?: "anchor" | "member";
    expiresAt: Date | null;
    maxUses: number | null;
    createdBy: string | null;
  },
): Promise<typeof invites.$inferSelect> {
  const rows = await db.insert(invites).values(values).returning();
  if (!rows[0]) throw new Error("failed to create invite");
  return rows[0];
}

export async function listInvites(
  db: DbExecutor,
  networkId: string,
): Promise<typeof invites.$inferSelect[]> {
  return db
    .select()
    .from(invites)
    .where(eq(invites.networkId, networkId))
    .orderBy(desc(invites.createdAt));
}

export async function getInvite(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<typeof invites.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(invites)
    .where(and(eq(invites.orgId, orgId), eq(invites.id, id)))
    .limit(1);
  return rows[0];
}

export async function findInviteByTokenHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<typeof invites.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function incrementInviteUses(
  db: DbExecutor,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1`, lastUsedAt: now })
    .where(eq(invites.id, id));
}

export async function touchInvite(
  db: DbExecutor,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .update(invites)
    .set({ lastUsedAt: now })
    .where(eq(invites.id, id));
}

export async function revokeInvite(
  db: DbExecutor,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .update(invites)
    .set({ revokedAt: now })
    .where(eq(invites.id, id));
}

export async function findDeviceInNetwork(
  db: DbExecutor,
  networkId: string,
  machineId: string,
): Promise<Device | undefined> {
  const rows = await db
    .select()
    .from(devices)
    .where(
      and(eq(devices.networkId, networkId), eq(devices.machineId, machineId)),
    )
    .limit(1);
  return rows[0];
}

export async function getDeviceById(
  db: DbExecutor,
  id: string,
): Promise<Device | undefined> {
  const rows = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  return rows[0];
}

export async function getNetworkById(
  db: DbExecutor,
  id: string,
): Promise<typeof networks.$inferSelect | undefined> {
  const rows = await db.select().from(networks).where(eq(networks.id, id)).limit(1);
  return rows[0];
}

export async function getDevice(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<Device | undefined> {
  const rows = await db
    .select()
    .from(devices)
    .where(and(eq(devices.orgId, orgId), eq(devices.id, id)))
    .limit(1);
  return rows[0];
}

export async function listDevices(
  db: DbExecutor,
  orgId: string,
  filters: { networkId?: string; state?: DeviceState } = {},
): Promise<Device[]> {
  const conditions = [eq(devices.orgId, orgId)];
  if (filters.networkId !== undefined) {
    conditions.push(eq(devices.networkId, filters.networkId));
  }
  if (filters.state !== undefined) {
    conditions.push(eq(devices.state, filters.state));
  }
  return db
    .select()
    .from(devices)
    .where(and(...conditions))
    .orderBy(desc(devices.lastSeenAt), asc(devices.hostname));
}

export async function insertDevice(
  db: DbExecutor,
  values: typeof devices.$inferInsert,
): Promise<Device> {
  const rows = await db.insert(devices).values(values).returning();
  if (!rows[0]) throw new Error("failed to create device");
  return rows[0];
}

export async function updateDevice(
  db: DbExecutor,
  id: string,
  values: Partial<typeof devices.$inferInsert>,
): Promise<Device | undefined> {
  const rows = await db
    .update(devices)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(devices.id, id))
    .returning();
  return rows[0];
}

export async function deleteDevice(db: DbExecutor, id: string): Promise<void> {
  await db.delete(devices).where(eq(devices.id, id));
}

export async function usedVirtualIps(
  db: DbExecutor,
  networkId: string,
): Promise<string[]> {
  const rows = await db
    .select({ ip: devices.virtualIpv4 })
    .from(devices)
    .where(
      and(eq(devices.networkId, networkId), sql`${devices.virtualIpv4} IS NOT NULL`),
    );
  return rows
    .map((row) => row.ip)
    .filter((ip): ip is string => typeof ip === "string" && ip.length > 0);
}

export async function listDevicesInNetwork(
  db: DbExecutor,
  networkId: string,
): Promise<Device[]> {
  return db
    .select()
    .from(devices)
    .where(eq(devices.networkId, networkId))
    .orderBy(asc(devices.dnsName));
}

export async function listDevicesForReconcile(
  db: DbExecutor,
  orgId: string,
): Promise<Device[]> {
  return db
    .select()
    .from(devices)
    .where(and(eq(devices.orgId, orgId), eq(devices.state, "approved")));
}

export async function pendingDeviceCount(
  db: DbExecutor,
  networkId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(devices)
    .where(
      and(eq(devices.networkId, networkId), eq(devices.state, "pending")),
    );
  return Number(rows[0]?.value ?? 0);
}

export async function insertRevision(
  db: DbExecutor,
  values: typeof configRevisions.$inferInsert,
): Promise<typeof configRevisions.$inferSelect> {
  const rows = await db.insert(configRevisions).values(values).returning();
  if (!rows[0]) throw new Error("failed to create config revision");
  return rows[0];
}

export async function listRevisions(
  db: DbExecutor,
  deviceId: string,
): Promise<(typeof configRevisions.$inferSelect)[]> {
  return db
    .select()
    .from(configRevisions)
    .where(eq(configRevisions.deviceId, deviceId))
    .orderBy(desc(configRevisions.revision));
}

export interface RevisionWithAuthor {
  revision: typeof configRevisions.$inferSelect;
  createdByEmail: string | null;
}

/** Revision history with the author's email for the "who/when" column. */
export async function listRevisionsWithAuthor(
  db: DbExecutor,
  deviceId: string,
): Promise<RevisionWithAuthor[]> {
  return db
    .select({ revision: configRevisions, createdByEmail: users.email })
    .from(configRevisions)
    .leftJoin(users, eq(users.id, configRevisions.createdBy))
    .where(eq(configRevisions.deviceId, deviceId))
    .orderBy(desc(configRevisions.revision));
}

export async function getRevision(
  db: DbExecutor,
  deviceId: string,
  revision: number,
): Promise<typeof configRevisions.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(configRevisions)
    .where(
      and(
        eq(configRevisions.deviceId, deviceId),
        eq(configRevisions.revision, revision),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertAudit(
  db: DbExecutor,
  values: typeof auditLog.$inferInsert,
): Promise<void> {
  await db.insert(auditLog).values(values);
}

export async function listAudit(
  db: DbExecutor,
  orgId: string,
  limit: number,
): Promise<(typeof auditLog.$inferSelect)[]> {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function deleteExpiredLoginStates(
  db: DbExecutor,
  now: Date,
): Promise<void> {
  await db
    .delete(oidcLoginStates)
    .where(lt(oidcLoginStates.expiresAt, now));
}

export async function findDevicesByIds(
  db: DbExecutor,
  orgId: string,
  ids: string[],
): Promise<Device[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(devices)
    .where(and(eq(devices.orgId, orgId), inArray(devices.id, ids)));
}

export async function findUnclaimedDevices(
  db: DbExecutor,
  orgId: string,
  networkId: string,
): Promise<Device[]> {
  return db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.orgId, orgId),
        eq(devices.networkId, networkId),
        or(isNull(devices.virtualIpv4), eq(devices.state, "pending")),
      ),
    );
}

// ---------------------------------------------------------------------------
// M2: policy, tags, MagicDNS and routes
// ---------------------------------------------------------------------------

export async function listTags(
  db: DbExecutor,
  orgId: string,
): Promise<(typeof tags.$inferSelect)[]> {
  return db.select().from(tags).where(eq(tags.orgId, orgId)).orderBy(asc(tags.name));
}

export async function upsertTag(
  db: DbExecutor,
  values: { orgId: string; name: string; color?: string },
): Promise<typeof tags.$inferSelect> {
  const rows = await db
    .insert(tags)
    .values({ orgId: values.orgId, name: values.name, color: values.color ?? "" })
    .onConflictDoUpdate({
      target: [tags.orgId, tags.name],
      set: { color: values.color ?? "" },
    })
    .returning();
  if (!rows[0]) throw new Error("failed to upsert tag");
  return rows[0];
}

export async function getTag(
  db: DbExecutor,
  orgId: string,
  name: string,
): Promise<typeof tags.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(tags)
    .where(and(eq(tags.orgId, orgId), eq(tags.name, name)))
    .limit(1);
  return rows[0];
}

export interface DeviceTagRow {
  deviceId: string;
  tagName: string;
}

export async function listDeviceTags(
  db: DbExecutor,
  orgId: string,
): Promise<DeviceTagRow[]> {
  const rows = await db
    .select({ deviceId: deviceTags.deviceId, tagName: tags.name })
    .from(deviceTags)
    .innerJoin(tags, eq(tags.id, deviceTags.tagId))
    .where(eq(tags.orgId, orgId));
  return rows;
}

export async function setDeviceTags(
  db: DbExecutor,
  deviceId: string,
  tagNames: string[],
): Promise<void> {
  await db.delete(deviceTags).where(eq(deviceTags.deviceId, deviceId));
  if (tagNames.length === 0) return;
  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.name, tagNames));
  const values = rows.map((row) => ({ deviceId, tagId: row.id }));
  if (values.length === 0) return;
  await db.insert(deviceTags).values(values).onConflictDoNothing();
}

export async function getNetworkPolicyVersion(
  db: DbExecutor,
  networkId: string,
  version: number,
): Promise<typeof networkPolicies.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(networkPolicies)
    .where(
      and(
        eq(networkPolicies.networkId, networkId),
        eq(networkPolicies.version, version),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function listNetworkPolicies(
  db: DbExecutor,
  networkId: string,
): Promise<(typeof networkPolicies.$inferSelect)[]> {
  return db
    .select()
    .from(networkPolicies)
    .where(eq(networkPolicies.networkId, networkId))
    .orderBy(desc(networkPolicies.version));
}

export async function insertNetworkPolicy(
  db: DbExecutor,
  values: typeof networkPolicies.$inferInsert,
): Promise<typeof networkPolicies.$inferSelect> {
  const rows = await db.insert(networkPolicies).values(values).returning();
  if (!rows[0]) throw new Error("failed to insert policy version");
  return rows[0];
}

export async function listNetworkRoutes(
  db: DbExecutor,
  networkId: string,
): Promise<DeviceRoute[]> {
  return db
    .select()
    .from(deviceRoutes)
    .where(eq(deviceRoutes.networkId, networkId))
    .orderBy(asc(deviceRoutes.createdAt));
}

export async function listDeviceRoutes(
  db: DbExecutor,
  deviceId: string,
): Promise<DeviceRoute[]> {
  return db
    .select()
    .from(deviceRoutes)
    .where(eq(deviceRoutes.deviceId, deviceId))
    .orderBy(asc(deviceRoutes.createdAt));
}

export async function getDeviceRoute(
  db: DbExecutor,
  id: string,
): Promise<DeviceRoute | undefined> {
  const rows = await db
    .select()
    .from(deviceRoutes)
    .where(eq(deviceRoutes.id, id))
    .limit(1);
  return rows[0];
}

export async function upsertDeviceRoute(
  db: DbExecutor,
  values: {
    orgId: string;
    networkId: string;
    deviceId: string;
    kind: DeviceRouteKind;
    cidr: string;
    requestedBy: string | null;
    note?: string;
  },
): Promise<DeviceRoute> {
  const rows = await db
    .insert(deviceRoutes)
    .values({
      orgId: values.orgId,
      networkId: values.networkId,
      deviceId: values.deviceId,
      kind: values.kind,
      cidr: values.cidr,
      state: "pending",
      note: values.note ?? "",
      requestedBy: values.requestedBy,
      decidedAt: null,
      decidedBy: null,
    })
    .onConflictDoUpdate({
      target: [deviceRoutes.deviceId, deviceRoutes.kind, deviceRoutes.cidr],
      set: {
        state: "pending",
        note: values.note ?? "",
        requestedBy: values.requestedBy,
        decidedAt: null,
        decidedBy: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!rows[0]) throw new Error("failed to request route");
  return rows[0];
}

export async function decideDeviceRoute(
  db: DbExecutor,
  id: string,
  values: {
    state: DeviceRouteState;
    decidedBy: string | null;
    note?: string;
  },
): Promise<DeviceRoute | undefined> {
  const rows = await db
    .update(deviceRoutes)
    .set({
      state: values.state,
      decidedBy: values.decidedBy,
      decidedAt: new Date(),
      ...(values.note !== undefined ? { note: values.note } : {}),
      updatedAt: new Date(),
    })
    .where(eq(deviceRoutes.id, id))
    .returning();
  return rows[0];
}

export async function approvedRoutesForDevice(
  db: DbExecutor,
  deviceId: string,
): Promise<DeviceRoute[]> {
  return db
    .select()
    .from(deviceRoutes)
    .where(
      and(eq(deviceRoutes.deviceId, deviceId), eq(deviceRoutes.state, "approved")),
    );
}

export async function approvedRoutesForNetwork(
  db: DbExecutor,
  networkId: string,
): Promise<DeviceRoute[]> {
  return db
    .select()
    .from(deviceRoutes)
    .where(
      and(
        eq(deviceRoutes.networkId, networkId),
        eq(deviceRoutes.state, "approved"),
      ),
    );
}

/** Every credential of an organisation (device list rendering). */
export async function listCredentialsForOrg(
  db: DbExecutor,
  orgId: string,
): Promise<Credential[]> {
  return db
    .select()
    .from(credentials)
    .where(eq(credentials.orgId, orgId))
    .orderBy(desc(credentials.createdAt));
}

/** Credentials of one network, newest first (including revoked history rows). */
export async function listCredentialsForNetwork(
  db: DbExecutor,
  networkId: string,
): Promise<Credential[]> {
  return db
    .select()
    .from(credentials)
    .where(eq(credentials.networkId, networkId))
    .orderBy(desc(credentials.createdAt));
}

/** Only credentials an anchor may publish: `active` and not past expiry. */
export async function listPublishableCredentials(
  db: DbExecutor,
  networkId: string,
  now: Date,
): Promise<Credential[]> {
  return db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.networkId, networkId),
        eq(credentials.status, "active"),
        gt(credentials.expiry, now),
      ),
    )
    .orderBy(asc(credentials.credentialId));
}

export async function getCredentialByDevice(
  db: DbExecutor,
  deviceId: string,
): Promise<Credential | undefined> {
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.deviceId, deviceId))
    .limit(1);
  return rows[0];
}

export async function getCredentialById(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<Credential | undefined> {
  const rows = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.orgId, orgId), eq(credentials.id, id)))
    .limit(1);
  return rows[0];
}

export async function insertCredential(
  db: DbExecutor,
  values: typeof credentials.$inferInsert,
): Promise<Credential> {
  const rows = await db.insert(credentials).values(values).returning();
  if (!rows[0]) throw new Error("failed to create credential");
  return rows[0];
}

export async function updateCredential(
  db: DbExecutor,
  id: string,
  values: Partial<typeof credentials.$inferInsert>,
): Promise<Credential | undefined> {
  const rows = await db
    .update(credentials)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(credentials.id, id))
    .returning();
  return rows[0];
}

/**
 * Credentials due for renewal: active, not yet expired, expiring before
 * `before`. Ordered by network so one renewal run can batch per network.
 */
export async function listCredentialsExpiringBefore(
  db: DbExecutor,
  before: Date,
  now: Date,
): Promise<Credential[]> {
  return db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.status, "active"),
        gt(credentials.expiry, now),
        lt(credentials.expiry, before),
      ),
    )
    .orderBy(asc(credentials.networkId), asc(credentials.expiry));
}

/** Approved devices of one network filtered by role. */
export async function listApprovedDevicesByRole(
  db: DbExecutor,
  networkId: string,
  role: "anchor" | "member",
): Promise<Device[]> {
  return db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.networkId, networkId),
        eq(devices.state, "approved"),
        eq(devices.role, role),
      ),
    )
    .orderBy(asc(devices.hostname));
}

export async function listApprovedDevicesInNetwork(
  db: DbExecutor,
  networkId: string,
): Promise<Device[]> {
  return db
    .select()
    .from(devices)
    .where(and(eq(devices.networkId, networkId), eq(devices.state, "approved")))
    .orderBy(asc(devices.hostname));
}

/** Every DNS name in use in a network, for uniqueness checks. */
export async function takenDnsNames(
  db: DbExecutor,
  networkId: string,
  excludeDeviceId?: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: devices.id, dnsName: devices.dnsName })
    .from(devices)
    .where(
      and(
        eq(devices.networkId, networkId),
        sql`${devices.dnsName} IS NOT NULL`,
        ...(excludeDeviceId ? [ne(devices.id, excludeDeviceId)] : []),
      ),
    );
  return rows
    .map((row) => row.dnsName)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

export async function findDeviceByDnsName(
  db: DbExecutor,
  networkId: string,
  dnsName: string,
): Promise<Device | undefined> {
  const rows = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.networkId, networkId),
        sql`lower(${devices.dnsName}) = lower(${dnsName})`,
      ),
    )
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Network peers (hub endpoints + raw external URLs)
// ---------------------------------------------------------------------------

export async function listNetworkPeers(
  db: DbExecutor,
  networkId: string,
): Promise<NetworkPeer[]> {
  return db
    .select()
    .from(networkPeers)
    .where(eq(networkPeers.networkId, networkId))
    .orderBy(asc(networkPeers.position));
}

export interface NetworkPeerRecord {
  peer: NetworkPeer;
  /** Referenced device, when the entry is device-backed or linked. */
  device: Device | null;
}

/**
 * The network's ordered peer list with each entry's device resolved in one
 * round-trip. This is exactly the input of the push compiler.
 */
export async function listNetworkPeerRecords(
  db: DbExecutor,
  networkId: string,
): Promise<NetworkPeerRecord[]> {
  return db
    .select({ peer: networkPeers, device: devices })
    .from(networkPeers)
    .leftJoin(devices, eq(devices.id, networkPeers.deviceId))
    .where(eq(networkPeers.networkId, networkId))
    .orderBy(asc(networkPeers.position));
}

export async function getNetworkPeer(
  db: DbExecutor,
  orgId: string,
  networkId: string,
  id: string,
): Promise<NetworkPeer | undefined> {
  const rows = await db
    .select()
    .from(networkPeers)
    .where(
      and(
        eq(networkPeers.orgId, orgId),
        eq(networkPeers.networkId, networkId),
        eq(networkPeers.id, id),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function nextNetworkPeerPosition(
  db: DbExecutor,
  networkId: string,
): Promise<number> {
  const rows = await db
    .select({ position: networkPeers.position })
    .from(networkPeers)
    .where(eq(networkPeers.networkId, networkId))
    .orderBy(desc(networkPeers.position))
    .limit(1);
  return (rows[0]?.position ?? -1) + 1;
}

export async function insertNetworkPeer(
  db: DbExecutor,
  values: typeof networkPeers.$inferInsert,
): Promise<NetworkPeer> {
  const rows = await db.insert(networkPeers).values(values).returning();
  if (!rows[0]) throw new Error("failed to insert network peer");
  return rows[0];
}

export async function updateNetworkPeer(
  db: DbExecutor,
  id: string,
  values: Partial<typeof networkPeers.$inferInsert>,
): Promise<NetworkPeer | undefined> {
  const rows = await db
    .update(networkPeers)
    .set(values)
    .where(eq(networkPeers.id, id))
    .returning();
  return rows[0];
}

export async function deleteNetworkPeer(db: DbExecutor, id: string): Promise<void> {
  await db.delete(networkPeers).where(eq(networkPeers.id, id));
}

export async function findDeviceBackedPeer(
  db: DbExecutor,
  networkId: string,
  deviceId: string,
): Promise<NetworkPeer | undefined> {
  const rows = await db
    .select()
    .from(networkPeers)
    .where(
      and(
        eq(networkPeers.networkId, networkId),
        eq(networkPeers.deviceId, deviceId),
        isNull(networkPeers.url),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function deleteDeviceBackedPeers(
  db: DbExecutor,
  networkId: string,
  deviceId: string,
): Promise<void> {
  await db
    .delete(networkPeers)
    .where(
      and(
        eq(networkPeers.networkId, networkId),
        eq(networkPeers.deviceId, deviceId),
        isNull(networkPeers.url),
      ),
    );
}

/**
 * Rewrites positions to 0..n-1 after a removal. Positions are updated in
 * ascending order, so a row only ever moves into a slot that was just vacated.
 */
export async function compactNetworkPeerPositions(
  db: DbExecutor,
  networkId: string,
): Promise<void> {
  const rows = await listNetworkPeers(db, networkId);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.position === index) continue;
    await db
      .update(networkPeers)
      .set({ position: index })
      .where(eq(networkPeers.id, row.id));
  }
}
