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
  groups: z.array(z.string()),
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
  magicDnsEnabled: z.boolean(),
  magicDnsZone: z.string(),
  policyVersion: z.number().int(),
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
  dnsName: z.string().nullable(),
  magicDnsName: z.string().nullable(),
  magicDnsZone: z.string(),
  magicDnsEnabled: z.boolean(),
  easytierVersion: z.string(),
  os: z.object({
    type: z.string(),
    version: z.string(),
    distribution: z.string(),
  }),
  sourceIp: z.string(),
  virtualIpv4: z.string().nullable(),
  inviteId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  tags: z.array(z.string()),
  reportedState: z.record(z.string(), z.unknown()),
  reportedStateAt: z.string().nullable(),
  desiredRevision: z.number().int().nullable(),
  appliedRevision: z.number().int().nullable(),
  policyVersion: z.number().int(),
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
  source: z.enum(["approval", "manual", "rollback", "policy"]),
  policyVersion: z.number().int().nullable(),
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
    magicDnsEnabled: z.boolean().optional(),
    magicDnsZone: z.string().min(3).max(200).optional(),
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
export const paramsRouteSchema = z.object({ routeId: z.string().uuid() });

// ---------------------------------------------------------------------------
// M2: policy, MagicDNS, tags and routes
// ---------------------------------------------------------------------------

export const policySummarySchema = z.object({
  statements: z.number().int(),
  tags: z.array(z.string()),
  groups: z.array(z.string()),
  hosts: z.array(z.string()),
  strictTags: z.boolean(),
});

export const policyVersionSchema = z.object({
  id: z.string(),
  networkId: z.string(),
  version: z.number().int(),
  document: z.record(z.string(), z.unknown()),
  note: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  summary: policySummarySchema,
});

export const policyStateSchema = z.object({
  version: z.number().int(),
  policy: policyVersionSchema.nullable(),
});

export const compiledAclSummarySchema = z.object({
  deviceId: z.string(),
  hostname: z.string(),
  inboundRules: z.number().int(),
  outboundRules: z.number().int(),
  forwardRules: z.number().int(),
  declaredGroups: z.array(z.string()),
  hash: z.string(),
});

export const reachabilitySchema = z.object({
  allowed: z.boolean(),
  egress: z.object({
    action: z.string(),
    matchedRule: z.string().nullable(),
  }),
  ingress: z.object({
    action: z.string(),
    matchedRule: z.string().nullable(),
  }),
  explanation: z.array(z.string()),
});

export const previewSchema = z.object({
  warnings: z.array(z.string()),
  devices: z.array(compiledAclSummarySchema),
  reachability: reachabilitySchema,
});

/** Either a parsed document or HuJSON text, validated by the policy module. */
export const savePolicySchema = z
  .object({
    document: z.record(z.string(), z.unknown()).optional(),
    /** HuJSON/JSON text; comments and trailing commas are allowed. */
    text: z.string().min(1).max(1_000_000).optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine(
    (value) => (value.document === undefined) !== (value.text === undefined),
    "provide exactly one of document or text",
  );

export const savePolicyTextSchema = z
  .object({
    /** HuJSON/JSON text; parsed with comments and trailing commas allowed. */
    text: z.string().min(1).max(1_000_000),
    note: z.string().max(500).optional(),
  })
  .strict();

export const previewInputSchema = z
  .object({
    document: z.record(z.string(), z.unknown()).optional(),
    /** HuJSON text of an unsaved document (advanced editor). */
    text: z.string().min(1).max(1_000_000).optional(),
    srcDeviceId: z.string().uuid(),
    dstDeviceId: z.string().uuid().optional(),
    dstCidr: z.string().max(32).optional(),
    port: z.number().int().min(0).max(65535).optional(),
    protocol: z.enum(["tcp", "udp", "icmp"]).default("tcp"),
  })
  .strict();

export const testReachabilitySchema = z
  .object({
    srcDeviceId: z.string().uuid(),
    dstDeviceId: z.string().uuid().optional(),
    dstCidr: z.string().max(32).optional(),
    port: z.number().int().min(0).max(65535).optional(),
    protocol: z.enum(["tcp", "udp", "icmp"]).default("tcp"),
  })
  .strict();

export const dnsNameSchema = z.object({
  deviceId: z.string(),
  hostname: z.string(),
  zone: z.string(),
  fqdn: z.string(),
  ipv4: z.string().nullable(),
  state: deviceStateSchema,
  reportedHostname: z.string(),
  renamed: z.boolean(),
});

export const renameDeviceSchema = z
  .object({ dnsName: z.string().min(1).max(63) })
  .strict();

export const deviceTagsSchema = z
  .object({ tags: z.array(z.string().min(1).max(120)).max(64) })
  .strict();

export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  deviceCount: z.number().int(),
});

export const createTagSchema = z
  .object({
    name: z.string().min(1).max(120),
    color: z.string().max(32).optional(),
  })
  .strict();

export const routeKindSchema = z.enum(["subnet", "exit_node"]);
export const routeStateSchema = z.enum(["pending", "approved", "rejected"]);

export const deviceRouteSchema = z.object({
  id: z.string(),
  networkId: z.string(),
  deviceId: z.string(),
  deviceHostname: z.string(),
  kind: routeKindSchema,
  cidr: z.string(),
  state: routeStateSchema,
  note: z.string(),
  requestedBy: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const reportedInstanceSchema = z.object({
  instanceId: z.string(),
  networkName: z.string(),
  hostname: z.string(),
  proxyCidrs: z.array(z.string()),
  exitNode: z.boolean(),
  unmanaged: z.boolean(),
  removable: z.boolean(),
});

export const peerObservationSchema = z.object({
  ipv4: z.string(),
  hostname: z.string(),
  proxyCidrs: z.array(z.string()),
  deviceId: z.string().optional(),
});

export const routeReportSchema = z.object({
  approvedCidrs: z.array(z.string()),
  /** Proxy CIDRs the device's own instance is configured with. */
  configuredCidrs: z.array(z.string()),
  /** CIDRs peers advertise for this device. */
  observedCidrs: z.array(z.string()),
  unapprovedCidrs: z.array(z.string()),
  unapprovedObservedCidrs: z.array(z.string()),
  missingCidrs: z.array(z.string()),
  reportedExitNode: z.boolean(),
  unmanagedInstances: z.array(reportedInstanceSchema),
  /** Peers advertising routes that are not known devices. */
  unknownPeers: z.array(peerObservationSchema),
});

export const routeReportEntrySchema = z.object({
  deviceId: z.string(),
  deviceHostname: z.string(),
  report: routeReportSchema.nullable(),
  collectedAt: z.string().nullable(),
});

export const routeListSchema = z.object({
  routes: z.array(deviceRouteSchema),
  reports: z.array(routeReportEntrySchema),
});

export const requestRouteSchema = z
  .object({
    kind: routeKindSchema,
    cidr: z.string().max(32).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const decideRouteSchema = z
  .object({
    state: z.enum(["approved", "rejected"]),
    note: z.string().max(500).optional(),
  })
  .strict();
