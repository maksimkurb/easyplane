import { formatIpv4, parseIpv4 } from "./ip.js";

/**
 * Subnet-route helpers.
 *
 * EasyTier semantics that matter here (easytier-core/src/config/api_input.rs):
 *
 * - `proxy_cidrs` (CLI `--proxy-networks`) makes *this* instance a subnet
 *   router: it advertises the CIDR to the network and forwards traffic to it.
 * - `enable_exit_node` makes this instance an exit node for `0.0.0.0/0`.
 * - `routes` + `enable_manual_routes` makes a *client* install routes towards
 *   the overlay, i.e. "accept routes from the network".
 *
 * There is no revocation channel for an instance that a client runs from a
 * local file: the control plane only owns the instance it created.
 */

export type RouteKind = "subnet" | "exit_node";
export type RouteState = "pending" | "approved" | "rejected";

/** Parses an IPv4 CIDR with a 0..32 prefix and returns the canonical form. */
export function normalizeCidr(raw: string): string {
  const value = raw.trim();
  const [address, prefixPart, extra] = value.split("/");
  if (!address || prefixPart === undefined || extra !== undefined) {
    throw new Error(`invalid CIDR: ${raw}`);
  }
  if (!/^\d{1,2}$/.test(prefixPart)) throw new Error(`invalid CIDR prefix: ${raw}`);
  const prefix = Number(prefixPart);
  if (prefix < 0 || prefix > 32) {
    throw new Error(`CIDR prefix must be between 0 and 32: ${raw}`);
  }
  const ip = parseIpv4(address);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return `${formatIpv4((ip & mask) >>> 0)}/${prefix}`;
}

export function cidrRange(cidr: string): { start: number; end: number } {
  const normalized = normalizeCidr(cidr);
  const [address, prefixPart] = normalized.split("/");
  const prefix = Number(prefixPart);
  const base = parseIpv4(address!);
  const size = 2 ** (32 - prefix);
  return { start: base, end: base + size - 1 };
}

/** True when `inner` is fully inside `outer`. */
export function cidrContains(outer: string, inner: string): boolean {
  const a = cidrRange(outer);
  const b = cidrRange(inner);
  return b.start >= a.start && b.end <= a.end;
}

export function cidrsOverlap(a: string, b: string): boolean {
  const left = cidrRange(a);
  const right = cidrRange(b);
  return left.start <= right.end && right.start <= left.end;
}

/** `/32` for a single address, used for ACL source/destination entries. */
export function ipv4ToHostCidr(address: string): string {
  return `${formatIpv4(parseIpv4(address))}/32`;
}

export interface RouteRecord {
  deviceId: string;
  kind: RouteKind;
  cidr: string;
  state: RouteState;
}

export function approvedSubnetCidrs(
  routes: readonly RouteRecord[],
  deviceId: string,
): string[] {
  const result = new Set<string>();
  for (const route of routes) {
    if (route.deviceId === deviceId && route.kind === "subnet" && route.state === "approved") {
      result.add(normalizeCidr(route.cidr));
    }
  }
  return [...result].sort();
}

export function approvedExitNode(
  routes: readonly RouteRecord[],
  deviceId: string,
): boolean {
  return routes.some(
    (route) =>
      route.deviceId === deviceId &&
      route.kind === "exit_node" &&
      route.state === "approved",
  );
}

/** All approved subnet routes of the network except the device's own. */
export function acceptedRoutesFor(
  routes: readonly RouteRecord[],
  deviceId: string,
): string[] {
  const result = new Set<string>();
  for (const route of routes) {
    if (
      route.kind === "subnet" &&
      route.state === "approved" &&
      route.deviceId !== deviceId
    ) {
      result.add(normalizeCidr(route.cidr));
    }
  }
  return [...result].sort();
}

/** What the client reported about one of its instances. */
export interface ReportedInstance {
  instanceId: string;
  networkName: string;
  hostname: string;
  proxyCidrs: string[];
  /** `enable_exit_node` from the instance config, when it could be read. */
  exitNode: boolean;
  /** True when this is not the instance EasyPlane manages for the device. */
  unmanaged: boolean;
  /** False when the instance came from a local file and cannot be modified. */
  removable: boolean;
}

/** A peer entry as another device's route table reports it. */
export interface PeerObservation {
  ipv4: string;
  hostname: string;
  proxyCidrs: string[];
  /** Device id when the observing side could match the peer to a device. */
  deviceId?: string;
}

export interface RouteReport {
  approvedCidrs: string[];
  /**
   * Proxy CIDRs the device's own instance is configured with
   * (GetNetworkInstanceConfig). For a managed instance this is what EasyPlane
   * pushed; a difference means drift.
   */
  configuredCidrs: string[];
  /** CIDRs peers advertise for this device (CollectNetworkInfo routes). */
  observedCidrs: string[];
  /** Configured CIDRs that are not approved for this device. */
  unapprovedCidrs: string[];
  /** Peer-observed CIDRs that are not approved for this device. */
  unapprovedObservedCidrs: string[];
  /** Approved CIDRs the client does not report (push pending or broken). */
  missingCidrs: string[];
  reportedExitNode: boolean;
  unmanagedInstances: ReportedInstance[];
  /** Peers advertising routes that EasyPlane does not know as devices. */
  unknownPeers: PeerObservation[];
}

/**
 * Compares what the device claims to route with what the control plane
 * approved. EasyTier reports proxy CIDRs per instance in CollectNetworkInfo, so
 * a locally started instance shows up even though it cannot be stopped from
 * here.
 */
export function buildRouteReport(input: {
  approvals: readonly RouteRecord[];
  deviceId: string;
  /** Own configured instance (GetNetworkInstanceConfig). */
  instances: readonly ReportedInstance[];
  /** What this device sees other peers advertising. */
  peerObservations: readonly PeerObservation[];
  /** Device ids known to the caller, used to classify peers. */
  knownDeviceIps?: Iterable<{ deviceId: string; ipv4: string }>;
}): RouteReport {
  const approved = approvedSubnetCidrs(input.approvals, input.deviceId);
  const approvedSet = new Set(approved);
  const configured = new Set<string>();
  const unapproved = new Set<string>();
  const unmanaged: ReportedInstance[] = [];
  let reportedExitNode = false;

  for (const instance of input.instances) {
    if (instance.unmanaged) unmanaged.push(instance);
    for (const raw of instance.proxyCidrs) {
      let cidr: string;
      try {
        cidr = normalizeCidr(raw);
      } catch {
        configured.add(raw);
        unapproved.add(raw);
        continue;
      }
      configured.add(cidr);
      if (!approvedSet.has(cidr)) unapproved.add(cidr);
    }
    if (instance.exitNode) reportedExitNode = true;
  }

  const knownIps = new Set(
    Array.from(input.knownDeviceIps ?? [], (entry) => entry.ipv4),
  );
  const observed = new Set<string>();
  const unknownPeers: PeerObservation[] = [];
  for (const peer of input.peerObservations) {
    for (const raw of peer.proxyCidrs) {
      try {
        observed.add(normalizeCidr(raw));
      } catch {
        observed.add(raw);
      }
    }
    if (!knownIps.has(peer.ipv4)) {
      unknownPeers.push({
        ...peer,
        proxyCidrs: peer.proxyCidrs.map((raw) => {
          try {
            return normalizeCidr(raw);
          } catch {
            return raw;
          }
        }),
      });
    }
  }
  const unapprovedObserved = [...observed].filter((cidr) => !approvedSet.has(cidr));

  return {
    approvedCidrs: approved,
    configuredCidrs: [...configured].sort(),
    observedCidrs: [...observed].sort(),
    unapprovedCidrs: [...unapproved].sort(),
    unapprovedObservedCidrs: unapprovedObserved.sort(),
    missingCidrs: approved.filter((cidr) => !configured.has(cidr)),
    reportedExitNode,
    unmanagedInstances: unmanaged,
    unknownPeers,
  };
}

/**
 * Validates a subnet request against the other routes in the network. Callers
 * pass the *other* devices' non-rejected routes: the same device may re-request
 * its own CIDR (the row is updated in place), and two devices serving the same
 * or overlapping CIDR would make routing ambiguous.
 */
export function validateSubnetRequest(
  cidr: string,
  existing: readonly RouteRecord[],
  deviceId?: string,
): { cidr: string } {
  const normalized = normalizeCidr(cidr);
  if (normalized === "0.0.0.0/0") {
    throw new Error(
      "0.0.0.0/0 is an exit node, not a subnet route; request an exit node instead",
    );
  }
  for (const route of existing) {
    if (route.kind !== "subnet" || route.state === "rejected") continue;
    // Re-requesting your own CIDR updates the row in place.
    if (deviceId && route.deviceId === deviceId && normalizeCidr(route.cidr) === normalized) {
      continue;
    }
    if (cidrsOverlap(route.cidr, normalized)) {
      throw new Error(
        `route ${normalized} overlaps ${route.cidr}, which is already requested or approved in this network`,
      );
    }
  }
  return { cidr: normalized };
}

export interface PeerObservationRecord extends PeerObservation {
  observerDeviceId: string;
  observerHostname: string;
  at: string;
}

/**
 * Merges what peers say a device advertises into its report. This is the only
 * way EasyTier exposes a device's own proxy CIDRs: `CollectNetworkInfo` route
 * entries deliberately exclude the local peer, so the control plane reads them
 * from the other members of the network.
 */
export function mergePeerObservations(
  report: RouteReport,
  observations: readonly PeerObservationRecord[],
  approvals: readonly RouteRecord[],
  deviceId: string,
): RouteReport {
  if (observations.length === 0) return report;
  const approved = new Set(approvedSubnetCidrs(approvals, deviceId));
  const observed = new Set(report.observedCidrs);
  for (const observation of observations) {
    for (const raw of observation.proxyCidrs) {
      try {
        observed.add(normalizeCidr(raw));
      } catch {
        observed.add(raw);
      }
    }
  }
  return {
    ...report,
    observedCidrs: [...observed].sort(),
    unapprovedObservedCidrs: [...observed]
      .filter((cidr) => !approved.has(cidr))
      .sort(),
  };
}
