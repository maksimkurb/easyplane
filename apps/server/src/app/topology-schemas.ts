import { z } from "zod";

/**
 * Topology API schemas. The shapes mirror `apps/server/src/topology/derive.ts`
 * one-to-one; Orval generates the web client types from these.
 */

export const tunnelProtocolSchema = z.enum([
  "tcp",
  "udp",
  "ws",
  "wss",
  "quic",
  "wg",
  "other",
]);

export const topologyNodeSchema = z.object({
  id: z.string(),
  deviceId: z.string().nullable(),
  hostname: z.string(),
  virtualIpv4: z.string().nullable(),
  networkLength: z.number().int().nullable(),
  version: z.string(),
  managed: z.boolean(),
  online: z.boolean(),
  peerId: z.number().int().nullable(),
  natType: z.string(),
  tcpNatType: z.string(),
  natFriendly: z.boolean(),
  publicIps: z.array(z.string()),
  listeners: z.array(z.string()),
  proxyCidrs: z.array(z.string()),
  featureFlags: z.object({
    isPublicServer: z.boolean(),
    avoidRelayData: z.boolean(),
    disableP2p: z.boolean(),
    quicInput: z.boolean(),
    kcpInput: z.boolean(),
  }),
  reachable: z.boolean(),
  relayCapable: z.boolean(),
  capabilityReasons: z.array(z.string()),
  relaysFor: z.array(z.string()),
  observed: z.boolean(),
});

export const topologyLinkEvidenceSchema = z.object({
  observedBy: z.string(),
  kind: z.enum(["direct", "relayed"]),
  via: z.string().nullable(),
  protocol: tunnelProtocolSchema,
  rawTunnelType: z.string(),
  latencyMs: z.number().nullable(),
  lossPercent: z.number().nullable(),
  cost: z.number().int().nullable(),
  pathLatencyMs: z.number().int().nullable(),
  direction: z.enum(["dialer", "acceptor", "unknown"]),
  localAddr: z.string().nullable(),
  remoteAddr: z.string().nullable(),
  rxBytes: z.string().nullable(),
  txBytes: z.string().nullable(),
  peerId: z.number().int(),
});

export const topologyLinkSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.enum(["direct", "relayed"]),
  via: z.string().nullable(),
  viaHostname: z.string().nullable(),
  protocol: tunnelProtocolSchema,
  rawTunnelType: z.string(),
  latencyMs: z.number().nullable(),
  lossPercent: z.number().nullable(),
  cost: z.number().int().nullable(),
  pathLatencyMs: z.number().int().nullable(),
  direction: z.enum(["dialer", "acceptor", "unknown"]),
  localAddr: z.string().nullable(),
  remoteAddr: z.string().nullable(),
  asymmetric: z.boolean(),
  observedBy: z.array(z.string()),
  evidence: z.array(topologyLinkEvidenceSchema),
});

export const rawPeerConnectionSchema = z.object({
  peerId: z.number().int(),
  connId: z.string(),
  protocol: tunnelProtocolSchema,
  rawTunnelType: z.string(),
  localAddr: z.string().nullable(),
  remoteAddr: z.string().nullable(),
  latencyMs: z.number().nullable(),
  lossPercent: z.number().nullable(),
  rxBytes: z.string(),
  txBytes: z.string(),
  rxPackets: z.string(),
  txPackets: z.string(),
  isClient: z.boolean(),
  isClosed: z.boolean(),
  direct: z.boolean(),
  networkName: z.string(),
});

export const rawPeerRouteSchema = z.object({
  peerId: z.number().int(),
  virtualIpv4: z.string().nullable(),
  hostname: z.string(),
  version: z.string(),
  cost: z.number().int(),
  pathLatencyMs: z.number().int(),
  nextHopPeerId: z.number().int(),
  nextHopHostname: z.string().nullable(),
  proxyCidrs: z.array(z.string()),
  natType: z.string(),
  tcpNatType: z.string(),
  isPublicServer: z.boolean(),
  avoidRelayData: z.boolean(),
});

export const topologyObservationSchema = z.object({
  deviceId: z.string(),
  hostname: z.string(),
  online: z.boolean(),
  collectedAt: z.string().nullable(),
  error: z.string().nullable(),
  peerId: z.number().int().nullable(),
  virtualIpv4: z.string().nullable(),
  version: z.string(),
  natType: z.string(),
  tcpNatType: z.string(),
  publicIps: z.array(z.string()),
  listeners: z.array(z.string()),
  events: z.array(z.string()),
  peers: z.array(rawPeerConnectionSchema),
  routes: z.array(rawPeerRouteSchema),
});

export const topologyStatsSchema = z.object({
  nodes: z.number().int(),
  managedNodes: z.number().int(),
  links: z.number().int(),
  directLinks: z.number().int(),
  relayedLinks: z.number().int(),
  reachableNodes: z.number().int(),
  relayCapableNodes: z.number().int(),
  hasReachableNode: z.boolean(),
  observations: z.number().int(),
  failedObservations: z.number().int(),
});

export const networkTopologySchema = z.object({
  networkId: z.string(),
  generation: z.number().int(),
  collectedAt: z.string(),
  partial: z.boolean(),
  intervalMs: z.number().int(),
  nodes: z.array(topologyNodeSchema),
  links: z.array(topologyLinkSchema),
  observations: z.array(topologyObservationSchema),
  stats: topologyStatsSchema,
});

export const deviceTopologySchema = z.object({
  deviceId: z.string(),
  networkId: z.string(),
  collectedAt: z.string(),
  generation: z.number().int(),
  node: topologyNodeSchema.nullable(),
  observation: topologyObservationSchema.nullable(),
  links: z.array(topologyLinkSchema),
});

export const topologyRefreshQuerySchema = z.object({
  refresh: z.enum(["0", "1"]).optional(),
});
