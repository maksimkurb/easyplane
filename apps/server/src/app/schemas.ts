import { z } from "zod";

export const roleSchema = z.enum(["admin", "member", "viewer"]);
/**
 * Inline enums (no shared constant): zod-to-openapi + orval otherwise emit the
 * same named enum into one file twice when it is used by two object schemas.
 */
const accessModeEnum = () => z.enum(["shared_secret", "credentials"]);
const deviceRoleEnum = () => z.enum(["anchor", "member"]);
export const accessModeSchema = accessModeEnum();
export const deviceRoleSchema = deviceRoleEnum();
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

export const networkRendezvousSchema = z.object({
  configured: z.boolean(),
  useBundled: z.boolean(),
  secretMatches: z.boolean().nullable(),
  endpoints: z.array(z.string()),
  relayData: z.boolean(),
  privateMode: z.boolean(),
  networkName: z.string().nullable(),
});

export const networkPeerPlanSchema = z.object({
  hubEndpoints: z.number().int(),
  rawPeers: z.number().int(),
  rendezvousEndpoints: z.number().int(),
  hasPeerEndpoint: z.boolean(),
});

export const rendezvousSchema = z.object({
  configured: z.boolean(),
  endpoints: z.array(z.string()),
  relayData: z.boolean(),
  privateMode: z.boolean(),
  networkName: z.string().nullable(),
  /** Whether the panel can verify a network secret against the node's. */
  secretComparisonAvailable: z.boolean(),
});

export const networkAccessSchema = z.object({
  mode: accessModeEnum(),
  anchors: z.number().int(),
  onlineAnchors: z.number().int(),
  members: z.number().int(),
  activeCredentials: z.number().int(),
  expiringCredentials: z.number().int(),
  warnings: z.array(
    z.enum([
      "no_anchor",
      "no_anchor_online",
      "only_one_anchor",
      "no_members",
      "rendezvous_needs_anchor",
      "credentials_expiring",
    ]),
  ),
});

export const credentialSchema = z.object({
  id: z.string(),
  networkId: z.string(),
  deviceId: z.string(),
  credentialId: z.string(),
  publicKey: z.string(),
  groups: z.array(z.string()),
  allowRelay: z.boolean(),
  allowedProxyCidrs: z.array(z.string()),
  reusable: z.boolean(),
  expiry: z.string(),
  status: z.enum(["active", "revoked", "expired"]),
  revocationReason: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
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
  policyMode: z.enum(["open", "rules", "json"]),
  useRendezvous: z.boolean(),
  p2pOnly: z.boolean(),
  access: networkAccessSchema,
  rendezvous: networkRendezvousSchema,
  peerPlan: networkPeerPlanSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  deviceCounts: networkCountsSchema,
});

export const inviteSchema = z.object({
  id: z.string(),
  networkId: z.string(),
  label: z.string(),
  role: deviceRoleEnum(),
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
  advertisedEndpoints: z.array(z.string()),
  isHub: z.boolean(),
  role: deviceRoleEnum(),
  effectiveRole: deviceRoleEnum(),
  knowsSecret: z.boolean(),
  accessMode: accessModeEnum(),
  credential: credentialSchema.nullable(),
  tags: z.array(z.string()),
  /** Exit-node badge: advertised-and-pending vs approved. */
  exitNode: z.enum(["none", "proposed", "approved"]),
  /** Client's instance file is read-only (the panel cannot read/change it). */
  configManagedLocally: z.boolean(),
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

export const networkPeerSchema = z.object({
  id: z.string(),
  networkId: z.string(),
  position: z.number().int(),
  kind: z.enum(["device", "external"]),
  url: z.string().nullable(),
  deviceId: z.string().nullable(),
  deviceHostname: z.string().nullable(),
  deviceDnsName: z.string().nullable(),
  deviceMachineId: z.string().nullable(),
  deviceState: deviceStateSchema.nullable(),
  deviceIsHub: z.boolean(),
  endpoints: z.array(z.string()),
  suggestedDeviceId: z.string().nullable(),
  suggestedDeviceHostname: z.string().nullable(),
  createdAt: z.string(),
});

export const networkPeersSchema = z.object({
  peers: z.array(networkPeerSchema),
});

export const createNetworkPeerSchema = z
  .object({
    /** Device-backed entry: every approved hub endpoint is dialled. */
    deviceId: z.string().uuid().optional(),
    /** Raw external URL, pushed verbatim to every other device. */
    url: z.string().min(1).max(512).optional(),
    /** Optional link on a raw URL: skip it for this device. */
    linkedDeviceId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (value) => (value.url === undefined) !== (value.deviceId === undefined),
    "provide exactly one of deviceId or url",
  )
  .refine(
    (value) => value.linkedDeviceId === undefined || value.url !== undefined,
    "linkedDeviceId is only valid together with url",
  );

export const linkNetworkPeerSchema = z
  .object({ deviceId: z.string().uuid() })
  .strict();

export const updateDeviceEndpointsSchema = z
  .object({ endpoints: z.array(z.string().min(1).max(512)).max(16) })
  .strict();

export const updateDeviceHubSchema = z.object({ isHub: z.boolean() }).strict();

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
    /** Dial the bundled rendezvous node from every device in this network. */
    useRendezvous: z.boolean().optional(),
    /** Push `p2p_only` to every device (advanced; disables relay fallback). */
    p2pOnly: z.boolean().optional(),
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
    /** Role the enrolled device gets in a credentials network. */
    role: deviceRoleEnum().optional(),
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

/** Body for block/delete: an anchor knows the secret, so removal is explicit. */
export const acknowledgeAnchorRiskSchema = z
  .object({ acknowledgeAnchorRisk: z.boolean().optional() })
  .strict()
  // Fastify validates an absent body as `null`; allow it so block/delete keep
  // working without a body (the acknowledgement is opt-in).
  .nullable();

export const accessModePreviewSchema = z
  .object({
    mode: accessModeEnum(),
    /** Devices that keep (credentials) or gain the secret. */
    anchorDeviceIds: z.array(z.string().uuid()).max(1000).optional(),
  })
  .strict();

export const switchAccessModeSchema = z
  .object({
    mode: accessModeEnum(),
    anchorDeviceIds: z.array(z.string().uuid()).max(1000).optional(),
    /** Required for credentials -> shared_secret (blast radius). */
    acknowledge: z.boolean().optional(),
  })
  .strict();

export const accessModePlanSchema = z.object({
  mode: accessModeEnum(),
  targetMode: accessModeEnum(),
  anchors: z.array(z.object({ deviceId: z.string(), hostname: z.string() })),
  members: z.array(
    z.object({
      deviceId: z.string(),
      hostname: z.string(),
      hasCredential: z.boolean(),
    }),
  ),
  pendingDevices: z.array(
    z.object({
      deviceId: z.string(),
      hostname: z.string(),
      role: deviceRoleEnum(),
    }),
  ),
  revokeCredentials: z.number().int(),
  gainSecret: z.number().int(),
  loseSecret: z.number().int(),
  warnings: z.array(z.string()),
  changes: z.boolean(),
});

export const switchAccessModeResponseSchema = z.object({
  network: networkSchema,
  plan: accessModePlanSchema,
});

export const setDeviceRoleSchema = z
  .object({
    role: deviceRoleEnum(),
    /** Accept that a demoted anchor still knows the secret. */
    acknowledge: z.boolean().optional(),
  })
  .strict();

export const setDeviceRoleResponseSchema = z.object({
  device: deviceSchema,
  /** True when anchor -> member requires a network secret rotation. */
  needsSecretRotation: z.boolean(),
});

export const rotateNetworkSecretResponseSchema = z.object({
  secret: z.string(),
  /** Credentials survive a rotation; members do not need to re-enrol. */
  credentialsSurvive: z.boolean().optional(),
  /** The bundled rendezvous node must use the same secret. */
  rendezvousNote: z.string().optional(),
});

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
export const paramsPeerSchema = z.object({
  networkId: z.string().uuid(),
  peerId: z.string().uuid(),
});
export const paramsRevisionSchema = z.object({
  deviceId: z.string().uuid(),
  revision: z.coerce.number().int().positive(),
});
export const paramsProviderSchema = z.object({ provider: z.string().min(1) });
export const paramsRouteSchema = z.object({ routeId: z.string().uuid() });

// ---------------------------------------------------------------------------
// M2: policy, MagicDNS, tags and routes
// ---------------------------------------------------------------------------

export const policyModeSchema = z.enum(["open", "rules", "json"]);

export const policyChainConfigSchema = z.object({
  default: z.enum(["allow", "block"]),
  enabled: z.boolean(),
  name: z.string().optional(),
});

export const policySummarySchema = z.object({
  statements: z.number().int(),
  tags: z.array(z.string()),
  groups: z.array(z.string()),
  hosts: z.array(z.string()),
  subnets: z.array(z.string()),
  strictTags: z.boolean(),
  strictGroups: z.boolean(),
  mode: policyModeSchema,
  chains: z.object({
    inbound: policyChainConfigSchema,
    outbound: policyChainConfigSchema,
    forward: policyChainConfigSchema,
  }),
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

export const subjectViewSchema = z.object({
  subject: z.string(),
  kind: z.enum(["any", "device", "tag", "group", "subnet", "host", "cidr"]),
  id: z.string(),
  name: z.string(),
  display: z.string(),
  detail: z.string().optional(),
  deviceCount: z.number().int(),
  peopleCount: z.number().int().optional(),
  readOnly: z.boolean().optional(),
  source: z.enum(["manual", "oidc"]).optional(),
});

export const policyRuleViewSchema = z.object({
  index: z.number().int(),
  name: z.string().nullable(),
  enabled: z.boolean(),
  action: z.enum(["allow", "deny"]),
  protocol: z.string(),
  ports: z.array(z.string()),
  sourcePorts: z.array(z.string()),
  stateful: z.boolean(),
  rateLimit: z.number().int().nullable(),
  burst: z.number().int().nullable(),
  from: z.array(subjectViewSchema),
  to: z.array(subjectViewSchema),
  affectedDeviceCount: z.number().int(),
});

export const policyStateSchema = z.object({
  version: z.number().int(),
  mode: policyModeSchema,
  policy: policyVersionSchema.nullable(),
  /** The active document after the v1 upgrade and collection enrichment. */
  document: z.record(z.string(), z.unknown()).nullable(),
  rules: z.array(policyRuleViewSchema),
  summary: policySummarySchema.nullable(),
  deviceCount: z.number().int(),
});

export const policyTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  color: z.string(),
  deviceCount: z.number().int(),
  devices: z.array(
    z.object({ id: z.string(), name: z.string(), hostname: z.string() }),
  ),
});

export const policyUserGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  source: z.enum(["manual", "oidc"]),
  readOnly: z.boolean(),
  color: z.string(),
  members: z.array(
    z.object({
      email: z.string(),
      displayName: z.string().nullable(),
      inOrganisation: z.boolean(),
    }),
  ),
  peopleCount: z.number().int(),
  deviceCount: z.number().int(),
  devices: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const policySubnetSchema = z.object({
  id: z.string(),
  name: z.string(),
  display: z.string(),
  cidr: z.string(),
  viaDeviceId: z.string().nullable(),
  viaHostname: z.string(),
  routeId: z.string().nullable(),
  approved: z.boolean(),
});

export const policyCatalogSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hostname: z.string(),
      virtualIpv4: z.string().nullable(),
      state: z.string(),
      tags: z.array(z.string()),
    }),
  ),
  tags: z.array(policyTagSchema),
  userGroups: z.array(policyUserGroupSchema),
  subnets: z.array(policySubnetSchema),
  hosts: z.array(
    z.object({ alias: z.string(), subject: z.string(), value: z.string() }),
  ),
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

export const compiledAclSchema = z.object({
  deviceId: z.string(),
  hostname: z.string(),
  virtualIpv4: z.string().nullable(),
  enabled: z.boolean(),
  policyVersion: z.number().int(),
  mode: policyModeSchema,
  chains: z.array(
    z.object({
      name: z.string(),
      chainType: z.enum(["Inbound", "Outbound", "Forward"]),
      enabled: z.boolean(),
      defaultAction: z.enum(["Allow", "Drop"]),
      rules: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          priority: z.number().int(),
          enabled: z.boolean(),
          protocol: z.string(),
          ports: z.array(z.string()),
          sourceIps: z.array(z.string()),
          destinationIps: z.array(z.string()),
          sourcePorts: z.array(z.string()),
          action: z.enum(["Allow", "Drop"]),
          rateLimit: z.number().int(),
          burstLimit: z.number().int(),
          stateful: z.boolean(),
          sourceGroups: z.array(z.string()),
          destinationGroups: z.array(z.string()),
        }),
      ),
    }),
  ),
  group: z.object({
    declares: z.array(z.object({ groupName: z.string() })),
    members: z.array(z.string()),
  }),
  hash: z.string(),
});

export const reachabilityTraceSchema = z.object({
  deviceId: z.string(),
  hostname: z.string(),
  chain: z.enum(["Inbound", "Outbound", "Forward"]),
  action: z.string(),
  matchedRule: z.string().nullable(),
  byDefault: z.boolean(),
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
  /** Best-effort per-hop trace; limits are documented in POLICY.md. */
  trace: z.array(reachabilityTraceSchema),
  decidedBy: z
    .object({ deviceId: z.string(), hostname: z.string(), chain: z.string() })
    .nullable(),
  srcIp: z.string(),
  dstIp: z.string(),
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
    /** Optional explicit mode; defaults to the document's mode. */
    mode: policyModeSchema.optional(),
  })
  .strict()
  .refine(
    (value) => (value.document === undefined) !== (value.text === undefined),
    "provide exactly one of document or text",
  );

export const savePolicyTextSchema = z
  .object({
    /** HuJSON/JSON text; comments and trailing commas allowed. */
    text: z.string().min(1).max(1_000_000),
    note: z.string().max(500).optional(),
  })
  .strict();

export const previewInputSchema = z
  .object({
    document: z.record(z.string(), z.unknown()).optional(),
    /** HuJSON text of an unsaved document (advanced editor). */
    text: z.string().min(1).max(1_000_000).optional(),
    srcDeviceId: z.string().uuid().optional(),
    /** Raw source IP or CIDR, for a host that is not an EasyPlane device. */
    srcIp: z.string().min(1).max(64).optional(),
    dstDeviceId: z.string().uuid().optional(),
    dstCidr: z.string().max(64).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    protocol: z.enum(["tcp", "udp", "icmp", "icmpv6"]).default("tcp"),
  })
  .strict()
  .refine(
    (value) => (value.srcDeviceId === undefined) !== (value.srcIp === undefined),
    "provide exactly one of srcDeviceId or srcIp",
  );

export const testReachabilitySchema = z
  .object({
    srcDeviceId: z.string().uuid().optional(),
    srcIp: z.string().min(1).max(64).optional(),
    dstDeviceId: z.string().uuid().optional(),
    dstCidr: z.string().max(64).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    protocol: z.enum(["tcp", "udp", "icmp", "icmpv6"]).default("tcp"),
  })
  .strict()
  .refine(
    (value) => (value.srcDeviceId === undefined) !== (value.srcIp === undefined),
    "provide exactly one of srcDeviceId or srcIp",
  );

export const policyModeInputSchema = z
  .object({ mode: policyModeSchema })
  .strict();

export const createUserGroupSchema = z
  .object({
    name: z.string().min(1).max(64),
    members: z.array(z.string().min(1).max(253)).max(2_000).optional(),
    source: z.enum(["manual", "oidc"]).optional(),
  })
  .strict();

export const userGroupMemberSchema = z
  .object({ email: z.string().min(3).max(253) })
  .strict();

export const assignTagSchema = z
  .object({ deviceIds: z.array(z.string().uuid()).max(10_000) })
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
  subject: z.string(),
  color: z.string(),
  deviceCount: z.number().int(),
  devices: z.array(
    z.object({ id: z.string(), name: z.string(), hostname: z.string() }),
  ),
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
  /** `panel` = requested by a user; `device_declared` = advertised by the device. */
  source: z.enum(["panel", "device_declared"]),
  note: z.string(),
  /** Last report that showed a declared route in the device's own config. */
  lastDeclaredAt: z.string().nullable(),
  /** Declared route still inside the advertised window (5 min). */
  advertised: z.boolean(),
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
  /** Device-declared CIDRs (pending or approved); not unapproved drift. */
  declaredCidrs: z.array(z.string()).default([]),
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
