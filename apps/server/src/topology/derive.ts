import { common, manage } from "@easyplane/proto";

import { formatIpv4 } from "../domain/ip.js";

/**
 * Topology derivation from real `CollectNetworkInfo` output.
 *
 * Everything here is derived from fields the pinned easytier-core actually
 * reports (see docs/REALTIME.md §5 for the field-by-field mapping and the
 * source references). Two facts shape the model:
 *
 *  - peer ids are per instance, not global, so the canonical node key is the
 *    overlay IPv4 (unique per managed device) or a synthetic key for a peer the
 *    control plane does not manage;
 *  - `Route.cost` is the OSPF path length: 1 means the peer is a direct
 *    neighbour, >1 means the traffic is relayed and `next_hop_peer_id` names the
 *    relay (the upstream CLI prints DIRECT for cost 1, see easytier-cli.rs).
 */

export type TunnelProtocol =
  | "tcp"
  | "udp"
  | "ws"
  | "wss"
  | "quic"
  | "wg"
  | "other";

export type LinkKind = "direct" | "relayed";
export type LinkDirection = "dialer" | "acceptor" | "unknown";

export interface TopologyNode {
  /** Stable across collections: `ip:<virtual ipv4>` or `peer:<observer>/<id>`. */
  id: string;
  /** Managed EasyPlane device id, or null for a peer the control plane does not own. */
  deviceId: string | null;
  hostname: string;
  virtualIpv4: string | null;
  networkLength: number | null;
  version: string;
  managed: boolean;
  online: boolean;
  /** peer id as seen by the observer that reported this node. */
  peerId: number | null;
  natType: string;
  tcpNatType: string;
  natFriendly: boolean;
  /** Public addresses this node reported for itself (STUN). */
  publicIps: string[];
  /** Listener URLs this node reported for itself. */
  listeners: string[];
  proxyCidrs: string[];
  featureFlags: {
    isPublicServer: boolean;
    avoidRelayData: boolean;
    disableP2p: boolean;
    quicInput: boolean;
    kcpInput: boolean;
  };
  /** Accepts inbound connections without NAT help (no NAT / static mapping). */
  reachable: boolean;
  /** Can relay for others: reachable, or observed relaying. */
  relayCapable: boolean;
  capabilityReasons: string[];
  /** Node ids for which this node was the next hop in a relayed route. */
  relaysFor: string[];
  /** True when this node's own instance reported the peer list (a probe). */
  observed: boolean;
  /**
   * `wireguard` marks a portal client added by the control plane, not an
   * EasyTier peer. It has an overlay address and a link to its hub, but no
   * instance, listeners or NAT information.
   */
  kind?: "device" | "wireguard";
}

export interface TopologyLinkEvidence {
  observedBy: string;
  kind: LinkKind;
  via: string | null;
  protocol: TunnelProtocol;
  rawTunnelType: string;
  latencyMs: number | null;
  lossPercent: number | null;
  cost: number | null;
  pathLatencyMs: number | null;
  direction: LinkDirection;
  localAddr: string | null;
  remoteAddr: string | null;
  rxBytes: string | null;
  txBytes: string | null;
  /** True when the protocol comes from the first hop of a relayed path. */
  protocolIsFirstHop: boolean;
  peerId: number;
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  kind: LinkKind;
  /** Relay node id for a relayed link. */
  via: string | null;
  viaHostname: string | null;
  protocol: TunnelProtocol;
  rawTunnelType: string;
  latencyMs: number | null;
  lossPercent: number | null;
  cost: number | null;
  pathLatencyMs: number | null;
  direction: LinkDirection;
  localAddr: string | null;
  remoteAddr: string | null;
  /** True when the protocol comes from the first hop of a relayed path. */
  protocolIsFirstHop: boolean;
  /** Views disagree (one side direct, the other relayed). */
  asymmetric: boolean;
  observedBy: string[];
  evidence: TopologyLinkEvidence[];
}

export interface RawPeerConnection {
  peerId: number;
  connId: string;
  protocol: TunnelProtocol;
  rawTunnelType: string;
  localAddr: string | null;
  remoteAddr: string | null;
  latencyMs: number | null;
  lossPercent: number | null;
  rxBytes: string;
  txBytes: string;
  rxPackets: string;
  txPackets: string;
  isClient: boolean;
  isClosed: boolean;
  direct: boolean;
  networkName: string;
}

export interface RawPeerRoute {
  peerId: number;
  virtualIpv4: string | null;
  hostname: string;
  version: string;
  cost: number;
  pathLatencyMs: number;
  nextHopPeerId: number;
  nextHopHostname: string | null;
  proxyCidrs: string[];
  natType: string;
  tcpNatType: string;
  isPublicServer: boolean;
  avoidRelayData: boolean;
}

export interface TopologyObservation {
  deviceId: string;
  hostname: string;
  online: boolean;
  collectedAt: string | null;
  error: string | null;
  peerId: number | null;
  virtualIpv4: string | null;
  version: string;
  natType: string;
  tcpNatType: string;
  publicIps: string[];
  listeners: string[];
  events: string[];
  peers: RawPeerConnection[];
  routes: RawPeerRoute[];
}

export interface TopologyStats {
  nodes: number;
  managedNodes: number;
  links: number;
  directLinks: number;
  relayedLinks: number;
  reachableNodes: number;
  relayCapableNodes: number;
  /** At least one node accepts inbound traffic without NAT help. */
  hasReachableNode: boolean;
  observations: number;
  failedObservations: number;
}

export interface NetworkTopologySnapshot {
  networkId: string;
  /** Increments per collection; the map uses it to drop out-of-order frames. */
  generation: number;
  collectedAt: string;
  /** True when at least one probe failed, so the map may be incomplete. */
  partial: boolean;
  /** Collection interval that produced this snapshot. */
  intervalMs: number;
  nodes: TopologyNode[];
  links: TopologyLink[];
  observations: TopologyObservation[];
  stats: TopologyStats;
}

export interface TopologyObserverInput {
  deviceId: string;
  /** Control-plane DNS name (authoritative display name). */
  hostname: string;
  /** Address allocated by the control plane, used if the client omits it. */
  virtualIpv4: string | null;
  online: boolean;
  tags?: string[];
  info?: manage.NetworkInstanceRunningInfo | undefined;
  error?: string | null;
  collectedAt?: number;
}

export interface DeriveTopologyOptions {
  networkId: string;
  generation?: number;
  collectedAt?: number;
  intervalMs?: number;
}

/**
 * Hard caps that keep one snapshot bounded even when an approved client
 * reports an unreasonable peer/route table. Hitting a cap marks the snapshot
 * `partial`, so the UI never pretends the graph is complete.
 */
export const TOPOLOGY_LIMITS = {
  nodes: 5_000,
  links: 20_000,
  rawPeers: 1_000,
  rawRoutes: 1_000,
} as const;

const IPV4_NAT_OPEN = new Set([
  common.NatType.OpenInternet,
  common.NatType.NoPAT,
]);

const NAT_FRIENDLY = new Set([
  common.NatType.OpenInternet,
  common.NatType.NoPAT,
  common.NatType.FullCone,
]);

const KNOWN_SCHEMES: ReadonlyArray<[RegExp, TunnelProtocol]> = [
  [/^wss\d*$/, "wss"],
  [/^ws\d*$/, "ws"],
  [/^tcp\d*$/, "tcp"],
  [/^udp\d*$/, "udp"],
  [/^quic\d*$/, "quic"],
  [/^wg\d*$/, "wg"],
];

/** `NatType` enum name; the CLI prints the same `{:?}` names. */
export function natTypeName(value: number | undefined): string {
  if (value === undefined) return "Unknown";
  for (const [name, enumValue] of Object.entries(common.NatType)) {
    if (typeof enumValue === "number" && enumValue === value) return name;
  }
  return "Unknown";
}

/**
 * Normalises `TunnelInfo.tunnel_type`. Upstream appends `6` for IPv6
 * (`tcp6`), may carry a composite `txt-tcp` transport prefix, and sometimes
 * contains a full `scheme://host:port` URL (see `display_tunnel_type`).
 */
export function normalizeTunnelProtocol(tunnelType: string | undefined): {
  protocol: TunnelProtocol;
  raw: string;
} {
  const raw = tunnelType ?? "";
  if (raw === "") return { protocol: "other", raw };
  let scheme = raw.trim().toLowerCase();
  const separator = scheme.indexOf("://");
  if (separator >= 0) scheme = scheme.slice(0, separator);
  // Composite transports are `prefix-scheme`, e.g. `txt-tcp`.
  const dash = scheme.lastIndexOf("-");
  const candidate = dash >= 0 ? scheme.slice(dash + 1) : scheme;
  for (const [pattern, protocol] of KNOWN_SCHEMES) {
    if (pattern.test(candidate)) return { protocol, raw };
  }
  return { protocol: "other", raw };
}

export function formatIpv4Inet(value: common.Ipv4Inet | undefined): string | null {
  if (!value?.address) return null;
  return formatIpv4(value.address.addr >>> 0);
}

function isOpenNat(udp: number, tcp: number): boolean {
  return IPV4_NAT_OPEN.has(udp) || IPV4_NAT_OPEN.has(tcp);
}

function latencyMsFromStats(stats: instance_stats | undefined): number | null {
  if (!stats) return null;
  const micros = Number(stats.latencyUs ?? 0n);
  if (!Number.isFinite(micros) || micros <= 0) return null;
  return Math.round((micros / 1000) * 10) / 10;
}

// Narrow structural type so bigint conversion stays local.
type instance_stats = {
  latencyUs: bigint;
  rxBytes: bigint;
  txBytes: bigint;
  rxPackets: bigint;
  txPackets: bigint;
};

function nodeKeyForIp(ipv4: string): string {
  return `ip:${ipv4}`;
}

function nodeKeyForPeer(observerDeviceId: string, peerId: number): string {
  return `peer:${observerDeviceId}/${peerId}`;
}

function emptyFlags(): TopologyNode["featureFlags"] {
  return {
    isPublicServer: false,
    avoidRelayData: false,
    disableP2p: false,
    quicInput: false,
    kcpInput: false,
  };
}

/**
 * Turns one `CollectNetworkInfo` response per device into a single graph of the
 * network. Pure and deterministic: unit tests run it over fixtures captured
 * from a real client (apps/server/test/fixtures/easytier).
 */
export function deriveTopology(
  inputs: readonly TopologyObserverInput[],
  options: DeriveTopologyOptions,
): NetworkTopologySnapshot {
  const collectedAt = options.collectedAt ?? Date.now();
  const generation = options.generation ?? 1;
  const nodes = new Map<string, TopologyNode>();
  const linkMap = new Map<string, TopologyLink>();
  const observations: TopologyObservation[] = [];
  let truncated = inputs.some(
    (input) =>
      (input.info?.peers.length ?? 0) > TOPOLOGY_LIMITS.rawPeers ||
      (input.info?.routes.length ?? 0) > TOPOLOGY_LIMITS.rawRoutes,
  );
  /** ipv4 -> deviceId for devices the control plane manages. */
  const managedByIp = new Map<string, string>();
  const deviceIds = new Set(inputs.map((input) => input.deviceId));

  for (const input of inputs) {
    const reportedIp = formatIpv4Inet(input.info?.myNodeInfo?.virtualIpv4);
    if (reportedIp) managedByIp.set(reportedIp, input.deviceId);
    else if (input.virtualIpv4) managedByIp.set(input.virtualIpv4, input.deviceId);
  }

  // Pass 1: managed nodes (one per observer, even when the probe failed).
  for (const input of inputs) {
    const ip =
      formatIpv4Inet(input.info?.myNodeInfo?.virtualIpv4) ??
      input.virtualIpv4 ??
      null;
    const key = ip ? nodeKeyForIp(ip) : `device:${input.deviceId}`;
    const stun = input.info?.myNodeInfo?.stunInfo;
    const node = ensureNode(nodes, key);
    node.deviceId = input.deviceId;
    node.managed = true;
    node.online = input.online && Boolean(input.info?.running);
    node.hostname = input.hostname || node.hostname;
    node.virtualIpv4 = ip;
    node.networkLength = input.info?.myNodeInfo?.virtualIpv4?.networkLength ?? null;
    node.version = input.info?.myNodeInfo?.version || node.version;
    node.peerId = input.info?.myNodeInfo?.peerId ?? node.peerId;
    node.listeners = (input.info?.myNodeInfo?.listeners ?? []).map(
      (listener) => listener.url,
    );
    node.publicIps = [...(stun?.publicIp ?? [])];
    node.natType = natTypeName(stun?.udpNatType);
    node.tcpNatType = natTypeName(stun?.tcpNatType);
    node.observed = node.observed || Boolean(input.info);

    observations.push({
      deviceId: input.deviceId,
      hostname: input.hostname,
      online: node.online,
      collectedAt: input.collectedAt ? new Date(input.collectedAt).toISOString() : null,
      error: input.error ?? input.info?.errorMsg ?? null,
      peerId: input.info?.myNodeInfo?.peerId ?? null,
      virtualIpv4: ip,
      version: input.info?.myNodeInfo?.version ?? "",
      natType: node.natType,
      tcpNatType: node.tcpNatType,
      publicIps: node.publicIps,
      listeners: node.listeners,
      events: [...(input.info?.events ?? [])],
      peers: (input.info?.peers ?? [])
        .slice(0, TOPOLOGY_LIMITS.rawPeers)
        .flatMap((peer) =>
        peer.conns.map((conn) => {
          const { protocol, raw } = normalizeTunnelProtocol(conn.tunnel?.tunnelType);
          const tunnel = conn.tunnel;
          return {
            peerId: peer.peerId,
            connId: conn.connId,
            protocol,
            rawTunnelType: raw,
            localAddr: tunnel?.localAddr?.url || null,
            remoteAddr:
              tunnel?.resolvedRemoteAddr?.url ?? tunnel?.remoteAddr?.url ?? null,
            latencyMs: latencyMsFromStats(conn.stats),
            lossPercent:
              conn.lossRate > 0 ? Math.round(conn.lossRate * 1000) / 10 : 0,
            rxBytes: (conn.stats?.rxBytes ?? 0n).toString(),
            txBytes: (conn.stats?.txBytes ?? 0n).toString(),
            rxPackets: (conn.stats?.rxPackets ?? 0n).toString(),
            txPackets: (conn.stats?.txPackets ?? 0n).toString(),
            isClient: conn.isClient,
            isClosed: conn.isClosed,
            direct: peer.directlyConnectedConns.length > 0,
            networkName: conn.networkName,
          };
        }),
      ),
      routes: (input.info?.routes ?? [])
        .slice(0, TOPOLOGY_LIMITS.rawRoutes)
        .map((route) => ({
        peerId: route.peerId,
        virtualIpv4: formatIpv4Inet(route.ipv4Addr),
        hostname: route.hostname,
        version: route.version,
        cost: route.cost,
        pathLatencyMs: route.pathLatency,
        nextHopPeerId: route.nextHopPeerId,
        nextHopHostname: null,
        proxyCidrs: [...route.proxyCidrs],
        natType: natTypeName(route.stunInfo?.udpNatType),
        tcpNatType: natTypeName(route.stunInfo?.tcpNatType),
        isPublicServer: Boolean(route.featureFlag?.isPublicServer),
        avoidRelayData: Boolean(route.featureFlag?.avoidRelayData),
      })),
    });
  }

  // Pass 2: peers and routes seen by each observer.
  for (const input of inputs) {
    if (!input.info) continue;
    const observerIp =
      formatIpv4Inet(input.info.myNodeInfo?.virtualIpv4) ?? input.virtualIpv4;
    const observerKey = observerIp
      ? nodeKeyForIp(observerIp)
      : `device:${input.deviceId}`;
    const selfPeerId = input.info.myNodeInfo?.peerId ?? null;

    const peerKeyById = new Map<number, string>();
    for (const route of input.info.routes ?? []) {
      const ip = formatIpv4Inet(route.ipv4Addr);
      const key = ip
        ? nodeKeyForIp(ip)
        : nodeKeyForPeer(input.deviceId, route.peerId);
      peerKeyById.set(route.peerId, key);
    }
    for (const peer of input.info.peers ?? []) {
      if (!peerKeyById.has(peer.peerId)) {
        // A connected peer without a route entry (route table converges a
        // moment later); still show the link.
        peerKeyById.set(
          peer.peerId,
          nodeKeyForPeer(input.deviceId, peer.peerId),
        );
      }
    }
    if (selfPeerId !== null) peerKeyById.set(selfPeerId, observerKey);

    const routeByPeer = new Map(
      (input.info.routes ?? []).map((route) => [route.peerId, route]),
    );

    for (const [peerId, key] of peerKeyById) {
      if (key === observerKey) continue;
      if (!nodes.has(key) && nodes.size >= TOPOLOGY_LIMITS.nodes) {
        truncated = true;
        continue;
      }
      const peer = (input.info.peers ?? []).find(
        (candidate) => candidate.peerId === peerId,
      );
      const route = routeByPeer.get(peerId);
      const node = ensureNode(nodes, key);

      if (route) {
        const ip = formatIpv4Inet(route.ipv4Addr);
        const managedDevice = ip ? managedByIp.get(ip) : undefined;
        node.virtualIpv4 = node.virtualIpv4 ?? ip;
        node.hostname = node.hostname || route.hostname;
        node.version = node.version || route.version;
        node.networkLength =
          node.networkLength ?? route.ipv4Addr?.networkLength ?? null;
        node.natType = pickNat(node.natType, natTypeName(route.stunInfo?.udpNatType));
        node.tcpNatType = pickNat(
          node.tcpNatType,
          natTypeName(route.stunInfo?.tcpNatType),
        );
        node.proxyCidrs = union(node.proxyCidrs, route.proxyCidrs);
        if (managedDevice) {
          node.deviceId = managedDevice;
          node.managed = true;
        }
        node.featureFlags.isPublicServer ||= Boolean(
          route.featureFlag?.isPublicServer,
        );
        node.featureFlags.avoidRelayData ||= Boolean(
          route.featureFlag?.avoidRelayData,
        );
        node.featureFlags.disableP2p ||= Boolean(route.featureFlag?.disableP2p);
        node.featureFlags.quicInput ||= Boolean(route.featureFlag?.quicInput);
        node.featureFlags.kcpInput ||= Boolean(route.featureFlag?.kcpInput);
        node.peerId = node.peerId ?? route.peerId;
      }

      // Managed devices already know their hostname/online state from the DB;
      // the reported value is only a fallback.
      if (node.managed && node.hostname === "" && route) {
        node.hostname = route.hostname;
      }

      const direct =
        (peer?.directlyConnectedConns.length ?? 0) > 0 || route?.cost === 1;
      const viaKey =
        !direct && route && route.nextHopPeerId !== 0
          ? (peerKeyById.get(route.nextHopPeerId) ?? null)
          : null;
      // A relayed peer has no direct connection, so the only transport this
      // observer can name is the first hop's tunnel to the relay node.
      const directConn = selectConnection(peer);
      const relayPeer =
        !direct && route
          ? (input.info.peers ?? []).find(
              (candidate) => candidate.peerId === route.nextHopPeerId,
            )
          : undefined;
      const conn = directConn ?? selectConnection(relayPeer);
      const { protocol, raw } = normalizeTunnelProtocol(conn?.tunnel?.tunnelType);
      const protocolIsFirstHop = !direct && directConn === undefined && conn !== undefined;

      const evidence: TopologyLinkEvidence = {
        observedBy: input.deviceId,
        kind: direct ? "direct" : "relayed",
        via: direct ? null : viaKey,
        protocol,
        rawTunnelType: raw,
        latencyMs: latencyMsFromStats(conn?.stats) ?? (direct ? null : route?.pathLatency ?? null),
        lossPercent:
          conn && conn.lossRate > 0
            ? Math.round(conn.lossRate * 1000) / 10
            : conn
              ? 0
              : null,
        cost: route?.cost ?? (direct ? 1 : null),
        pathLatencyMs: route?.pathLatency ?? null,
        direction: conn ? (conn.isClient ? "dialer" : "acceptor") : "unknown",
        localAddr: conn?.tunnel?.localAddr?.url || null,
        remoteAddr:
          conn?.tunnel?.resolvedRemoteAddr?.url ??
          conn?.tunnel?.remoteAddr?.url ??
          null,
        rxBytes: conn?.stats ? conn.stats.rxBytes.toString() : null,
        txBytes: conn?.stats ? conn.stats.txBytes.toString() : null,
        protocolIsFirstHop,
        peerId,
      };

      if (!node.online && !node.managed) node.online = true;
      if (!node.hostname) node.hostname = `peer ${peerId}`;

      if (
        !linkMap.has(linkId(observerKey, key)) &&
        linkMap.size >= TOPOLOGY_LIMITS.links
      ) {
        truncated = true;
        continue;
      }
      mergeLink(nodes, linkMap, observerKey, key, evidence);
    }
  }

  // Pass 3: relay bookkeeping and capability flags (after all links exist).
  for (const link of collectLinks(linkMap, nodes)) {
    if (link.kind !== "relayed" || !link.via) continue;
    const relay = nodes.get(link.via);
    if (relay) {
      relay.relaysFor = union(relay.relaysFor, [link.source, link.target]).sort();
    }
  }

  for (const node of nodes.values()) {
    const reasons: string[] = [];
    const openNat =
      IPV4_NAT_OPEN.has(natEnum(node.natType)) ||
      IPV4_NAT_OPEN.has(natEnum(node.tcpNatType));
    if (openNat) reasons.push(`nat:${node.natType}`);
    if (node.featureFlags.isPublicServer) reasons.push("public-server-flag");
    const reachable = openNat || node.featureFlags.isPublicServer;
    if (node.relaysFor.length > 0) {
      reasons.push(`relaying-for:${node.relaysFor.length}`);
    }
    node.reachable = reachable;
    node.relayCapable = reachable || node.relaysFor.length > 0;
    node.natFriendly =
      NAT_FRIENDLY.has(natEnum(node.natType)) ||
      NAT_FRIENDLY.has(natEnum(node.tcpNatType));
    node.capabilityReasons = reasons;
    if (!node.managed) {
      // A node both sides reach through the overlay is online by observation.
      node.online = node.online || node.relaysFor.length > 0;
    }
  }

  const links = collectLinks(linkMap, nodes);
  const nodesByDevice = new Map<string, TopologyNode>();
  for (const node of nodes.values()) {
    if (node.deviceId) nodesByDevice.set(node.deviceId, node);
  }
  for (const input of inputs) {
    // Make sure the device's own state wins over peer-reported guesses.
    const node = nodesByDevice.get(input.deviceId);
    if (node) node.online = input.online && Boolean(input.info?.running);
  }

  const nodeList = [...nodes.values()].sort(compareTopologyNodes);
  const reachableNodes = nodeList.filter((node) => node.reachable).length;

  return {
    networkId: options.networkId,
    generation,
    collectedAt: new Date(collectedAt).toISOString(),
    partial: truncated || observations.some((observation) => observation.error !== null),
    intervalMs: options.intervalMs ?? 0,
    nodes: nodeList,
    links,
    observations,
    stats: {
      nodes: nodeList.length,
      managedNodes: nodeList.filter((node) => node.managed).length,
      links: links.length,
      directLinks: links.filter((link) => link.kind === "direct").length,
      relayedLinks: links.filter((link) => link.kind === "relayed").length,
      reachableNodes,
      relayCapableNodes: nodeList.filter((node) => node.relayCapable).length,
      hasReachableNode: reachableNodes > 0,
      observations: observations.length,
      failedObservations: observations.filter((o) => o.error !== null).length,
    },
  };
}

function natEnum(name: string): common.NatType {
  const value = (common.NatType as Record<string, unknown>)[name];
  return typeof value === "number" ? (value as common.NatType) : common.NatType.Unknown;
}

function pickNat(current: string, candidate: string): string {
  if (candidate === "Unknown") return current;
  return current === "Unknown" ? candidate : current;
}

function union(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])].sort();
}

function ensureNode(
  nodes: Map<string, TopologyNode>,
  key: string,
): TopologyNode {
  const existing = nodes.get(key);
  if (existing) return existing;
  const node: TopologyNode = {
    id: key,
    deviceId: null,
    hostname: "",
    virtualIpv4: null,
    networkLength: null,
    version: "",
    managed: false,
    online: false,
    peerId: null,
    natType: "Unknown",
    tcpNatType: "Unknown",
    natFriendly: false,
    publicIps: [],
    listeners: [],
    proxyCidrs: [],
    featureFlags: emptyFlags(),
    reachable: false,
    relayCapable: false,
    capabilityReasons: [],
    relaysFor: [],
    observed: false,
  };
  nodes.set(key, node);
  return node;
}

function selectConnection(
  peer: instance_peer | undefined,
): instance_conn | undefined {
  if (!peer) return undefined;
  const open = peer.conns.filter((conn) => !conn.isClosed);
  const pool = open.length > 0 ? open : peer.conns;
  if (pool.length === 0) return undefined;
  const defaultId = peer.defaultConnId
    ? uuidFromProto(peer.defaultConnId)
    : undefined;
  const preferred = defaultId
    ? pool.find((conn) => conn.connId === defaultId)
    : undefined;
  if (preferred) return preferred;
  const direct = pool.find((conn) =>
    peer.directlyConnectedConns.some(
      (id) => uuidFromProto(id) === conn.connId,
    ),
  );
  return direct ?? pool[0];
}

// Structural aliases keep this module independent of ts-proto class wrappers.
type instance_peer = {
  peerId: number;
  conns: instance_conn[];
  defaultConnId?: { part1: number; part2: number; part3: number; part4: number } | undefined;
  directlyConnectedConns: Array<{
    part1: number;
    part2: number;
    part3: number;
    part4: number;
  }>;
};
type instance_conn = {
  connId: string;
  isClient: boolean;
  isClosed: boolean;
  lossRate: number;
  networkName: string;
  stats?: instance_stats | undefined;
  tunnel?: common.TunnelInfo | undefined;
};

function uuidFromProto(uuid: {
  part1: number;
  part2: number;
  part3: number;
  part4: number;
}): string {
  const hex = (value: number) => value.toString(16).padStart(8, "0");
  const raw = `${hex(uuid.part1)}${hex(uuid.part2)}${hex(uuid.part3)}${hex(uuid.part4)}`;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

/** Links live in a side map keyed by the unordered node pair. */
function linkId(source: string, target: string): string {
  const [left, right] = source <= target ? [source, target] : [target, source];
  return `${left}--${right}`;
}

function mergeLink(
  nodes: Map<string, TopologyNode>,
  links: Map<string, TopologyLink>,
  source: string,
  target: string,
  evidence: TopologyLinkEvidence,
): void {
  const id = linkId(source, target);
  const [left, right] = source <= target ? [source, target] : [target, source];
  const existing = links.get(id);
  if (!existing) {
    links.set(id, {
      id,
      source: left,
      target: right,
      kind: evidence.kind,
      via: evidence.via,
      viaHostname: evidence.via ? (nodes.get(evidence.via)?.hostname ?? null) : null,
      protocol: evidence.protocol,
      rawTunnelType: evidence.rawTunnelType,
      latencyMs: evidence.latencyMs,
      lossPercent: evidence.lossPercent,
      cost: evidence.cost,
      pathLatencyMs: evidence.pathLatencyMs,
      direction: evidence.direction,
      localAddr: evidence.localAddr,
      remoteAddr: evidence.remoteAddr,
      protocolIsFirstHop: evidence.protocolIsFirstHop,
      asymmetric: false,
      observedBy: [evidence.observedBy],
      evidence: [evidence],
    });
    return;
  }

  existing.observedBy = union(existing.observedBy, [evidence.observedBy]);
  existing.evidence.push(evidence);
  if (existing.kind !== evidence.kind) existing.asymmetric = true;

  const preferIncoming =
    evidence.kind === "direct" && existing.kind === "relayed";
  if (preferIncoming) {
    existing.kind = "direct";
    existing.protocol = evidence.protocol;
    existing.rawTunnelType = evidence.rawTunnelType;
    existing.latencyMs = evidence.latencyMs;
    existing.lossPercent = evidence.lossPercent;
    existing.direction = evidence.direction;
    existing.localAddr = evidence.localAddr;
    existing.remoteAddr = evidence.remoteAddr;
    existing.protocolIsFirstHop = false;
    existing.via = null;
    existing.viaHostname = null;
  } else if (!existing.asymmetric) {
    if (existing.kind === "relayed" && evidence.kind === "relayed") {
      // Prefer the view with the shorter path (and a named relay).
      if (existing.via === null && evidence.via !== null) {
        existing.via = evidence.via;
        existing.viaHostname = nodes.get(evidence.via)?.hostname ?? null;
      } else if (
        existing.cost !== null &&
        evidence.cost !== null &&
        evidence.cost < existing.cost
      ) {
        existing.via = evidence.via;
        existing.viaHostname = evidence.via
          ? (nodes.get(evidence.via)?.hostname ?? null)
          : null;
      }
      if (existing.latencyMs === null && evidence.latencyMs !== null) {
        existing.latencyMs = evidence.latencyMs;
        existing.protocol = evidence.protocol;
      }
    }
  }
  if (existing.cost === null || (evidence.cost !== null && evidence.cost < existing.cost)) {
    existing.cost = evidence.cost;
  }
  if (existing.pathLatencyMs === null && evidence.pathLatencyMs !== null) {
    existing.pathLatencyMs = evidence.pathLatencyMs;
  }
}

/** Display name of a node, falling back to the stable node id. */
function nodeLabel(node: TopologyNode | undefined, nodeId: string): string {
  return node?.hostname || nodeId;
}

/**
 * Canonical endpoint labels of a link.
 *
 * A link is stored for an unordered pair, so sorting on the unordered pair is
 * the same as sorting by the neighbour's name from either endpoint: when one
 * endpoint is fixed (the device drawer), the pair key orders by the other one.
 */
function endpointLabels(
  link: TopologyLink,
  nameOf: (nodeId: string) => string,
): [string, string] {
  const source = nameOf(link.source);
  const target = nameOf(link.target);
  return source <= target ? [source, target] : [target, source];
}

/**
 * Stable order for topology links: by the endpoint names the UI shows (the
 * neighbour in the device drawer), then by the link id as a tie-breaker.
 *
 * Exported for unit tests; callers pass `id => node.hostname || id`.
 */
export function compareTopologyLinks(
  left: TopologyLink,
  right: TopologyLink,
  nameOf: (nodeId: string) => string,
): number {
  const [leftFirst, leftSecond] = endpointLabels(left, nameOf);
  const [rightFirst, rightSecond] = endpointLabels(right, nameOf);
  return (
    leftFirst.localeCompare(rightFirst) ||
    leftSecond.localeCompare(rightSecond) ||
    left.id.localeCompare(right.id)
  );
}

function collectLinks(
  links: Map<string, TopologyLink>,
  nodes: Map<string, TopologyNode>,
): TopologyLink[] {
  return [...links.values()].sort((left, right) =>
    compareTopologyLinks(left, right, (nodeId) =>
      nodeLabel(nodes.get(nodeId), nodeId),
    ),
  );
}

/**
 * Stable order for topology nodes: hostname (falling back to the node id),
 * then the node id.
 *
 * Deliberately ignores `online` and `managed`: both flip between heartbeats and
 * made rows jump every collection. `createdAt` is not part of the topology API
 * schema (and must not change the generated web client), so the hostname is the
 * first key here; the devices list itself is ordered by creation time.
 */
export function compareTopologyNodes(
  left: TopologyNode,
  right: TopologyNode,
): number {
  const byName = nodeLabel(left, left.id).localeCompare(nodeLabel(right, right.id));
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id);
}
