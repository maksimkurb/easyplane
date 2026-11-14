import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  auditLog,
  configRevisions,
  devices,
  invites,
  networks,
  oidcLoginStates,
  organisations,
  sessions,
  userIdentities,
  users,
  type Device,
  type DeviceState,
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
    })
    .returning();
  if (!rows[0]) throw new Error("failed to create user");
  return rows[0];
}

export async function updateUser(
  db: DbExecutor,
  id: string,
  values: Partial<
    Pick<User, "displayName" | "role" | "lastLoginAt" | "disabled" | "bootstrap">
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
      "name" | "ipv4Cidr" | "defaultConfig" | "secretCiphertext"
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
