import { z } from "zod";

export const roleSchema = z.enum(["admin", "member", "viewer"]);
export const deviceStateSchema = z.enum(["pending", "approved", "blocked"]);
export const syncStateSchema = z.enum([
  "not-applicable",
  "in-sync",
  "stale",
  "error",
]);
export const onlineStateSchema = z.enum(["online", "offline"]);

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  bootstrap: z.boolean(),
  lastLoginAt: z.string().nullable(),
});

export const orgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const networkCountsSchema = z.object({
  pending: z.number().int(),
  approved: z.number().int(),
  blocked: z.number().int(),
});

export const networkSchema = z.object({
  id: z.string(),
  name: z.string(),
  networkName: z.string(),
  ipv4Cidr: z.string(),
  defaultConfig: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  deviceCounts: networkCountsSchema,
});

export const inviteSchema = z.object({
  id: z.string(),
  networkId: z.string(),
  label: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  reusable: z.boolean(),
  remainingUses: z.number().int().nullable(),
  status: z.enum(["active", "expired", "exhausted", "revoked"]),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});

export const deviceSchema = z.object({
  id: z.string(),
  networkId: z.string(),
  networkName: z.string(),
  state: deviceStateSchema,
  online: onlineStateSchema,
  sync: syncStateSchema,
  label: z.string(),
  machineId: z.string(),
  hostname: z.string(),
  easytierVersion: z.string(),
  os: z.object({
    type: z.string(),
    version: z.string(),
    distribution: z.string(),
  }),
  sourceIp: z.string(),
  virtualIpv4: z.string().nullable(),
  inviteId: z.string().nullable(),
  desiredRevision: z.number().int().nullable(),
  appliedRevision: z.number().int().nullable(),
  appliedAt: z.string().nullable(),
  lastPushAt: z.string().nullable(),
  lastPushError: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  blockedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const revisionSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  revision: z.number().int(),
  config: z.record(z.string(), z.unknown()),
  note: z.string(),
  source: z.enum(["approval", "manual", "rollback"]),
  rollbackOfRevision: z.number().int().nullable(),
  createdBy: z.string().nullable(),
  createdByEmail: z.string().nullable(),
  createdAt: z.string(),
});

export const auditSchema = z.object({
  id: z.string(),
  actorUserId: z.string().nullable(),
  actorType: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const errorSchema = z.object({
  error: z.string(),
  code: z.string(),
});

export const okSchema = z.object({
  status: z.literal("ok"),
});

export const appConfigSchema = z.object({
  orgName: z.string(),
  publicUrl: z.string().nullable(),
  publicConfigServerUrl: z.string().nullable(),
  bootstrapAvailable: z.boolean(),
  providers: z.array(
    z.object({ id: z.string(), label: z.string(), issuer: z.string() }),
  ),
});

export const loginProvidersSchema = z.object({
  providers: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const meSchema = z.object({
  user: userSchema,
  organisation: orgSchema,
  csrfToken: z.string(),
  providers: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const pushResultSchema = z.object({
  status: z.string(),
  revision: z.number().int().optional(),
  reason: z.string().optional(),
});

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  uptimeSeconds: z.number(),
  database: z.enum(["ok", "down"]),
  clients: z.number().int(),
});

export const patchNetworkSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    ipv4Cidr: z.string().min(1).max(32).optional(),
  })
  .strict();

export const createNetworkSchema = z
  .object({
    name: z.string().min(1).max(120),
    ipv4Cidr: z.string().min(8).max(32).optional(),
    defaultConfig: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createInviteSchema = z
  .object({
    label: z.string().max(120).optional(),
    expiresInHours: z.number().int().min(1).max(8760).nullable().optional(),
    maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
  })
  .strict();

export const createInviteResponseSchema = z.object({
  invite: inviteSchema,
  token: z.string(),
});

export const approveDeviceSchema = z
  .object({ virtualIpv4: z.string().optional() })
  .strict();

export const createRevisionSchema = z
  .object({
    config: z.record(z.string(), z.unknown()),
    note: z.string().max(500).optional(),
  })
  .strict();

export const createRevisionResponseSchema = z.object({
  revision: revisionSchema,
  device: deviceSchema,
});

export const paramsIdSchema = z.object({ id: z.string().uuid() });
export const paramsNetworkSchema = z.object({ networkId: z.string().uuid() });
export const paramsDeviceSchema = z.object({ deviceId: z.string().uuid() });
export const paramsInviteSchema = z.object({ inviteId: z.string().uuid() });
export const paramsRevisionSchema = z.object({
  deviceId: z.string().uuid(),
  revision: z.coerce.number().int().positive(),
});
export const paramsProviderSchema = z.object({ provider: z.string().min(1) });
