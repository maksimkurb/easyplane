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
/** Who asked for the route (docs/POLICY.md §7.1). */
export type RouteSource = "panel" | "device_declared";

/**
 * How long a `device_declared` row stays "advertised" after the last report
 * that showed it. The route report runs every 30 s by default, so this tolerates
 * several missed reports (and a short offline window) before the UI says
 * "no longer advertised".
 */
export const DECLARED_ADVERTISED_WINDOW_MS = 5 * 60_000;

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
  /** Absent on older callers; treated as `panel`. */
  source?: RouteSource;
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

/**
 * Subnets the device itself declares in its persisted config, whether the
 * admin has decided or not. A push always includes them in the device's own
 * `proxy_cidrs`, so a local edit is never erased while a proposal is pending
 * (docs/SPIKE-DECLARED-ROUTES.md §8).
 */
export function declaredSubnetCidrs(
  routes: readonly RouteRecord[],
  deviceId: string,
): string[] {
  const result = new Set<string>();
  for (const route of routes) {
    if (
      route.deviceId === deviceId &&
      route.kind === "subnet" &&
      route.source === "device_declared" &&
      route.state !== "rejected"
    ) {
      result.add(normalizeCidr(route.cidr));
    }
  }
  return [...result].sort();
}

/** True when the device declares an exit node that is pending or approved. */
export function declaredExitNode(
  routes: readonly RouteRecord[],
  deviceId: string,
): boolean {
  return routes.some(
    (route) =>
      route.deviceId === deviceId &&
      route.kind === "exit_node" &&
      route.source === "device_declared" &&
      route.state !== "rejected",
  );
}

/** `device_declared` row still present in the reports (not stale). */
export function isDeclaredRouteAdvertised(
  lastDeclaredAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastDeclaredAt) return false;
  const at =
    lastDeclaredAt instanceof Date ? lastDeclaredAt.getTime() : Date.parse(lastDeclaredAt);
  if (!Number.isFinite(at)) return false;
  return now - at < DECLARED_ADVERTISED_WINDOW_MS;
}

/**
 * Normalises a CIDR a device advertises in its own config and drops values the
 * control plane must not turn into a proposal: `0.0.0.0/0` is an exit node (not
 * a subnet route) and a CIDR that contains or sits inside the overlay would
 * swallow or replace the overlay route. Returns `null` for those.
 */
export function declarableCidr(raw: string, overlayCidr: string): string | null {
  let cidr: string;
  try {
    cidr = normalizeCidr(raw);
  } catch {
    return null;
  }
  if (cidr === "0.0.0.0/0") return null;
  try {
    if (cidrContains(cidr, overlayCidr) || cidrContains(overlayCidr, cidr)) {
      return null;
    }
  } catch {
    return null;
  }
  return cidr;
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

/**
 * Approved subnet CIDRs of the whole network, regardless of owner.
 *
 * Peer observations are a property of the *network*, not of the observing
 * device: a CIDR another member advertises is legitimate when some device has
 * an approved row for it. Judging them against the observing device's own
 * approvals made every inter-router subnet (h1 sees h3's /24) look unapproved.
 * Only `approved` counts here; a pending or rejected proposal of a peer stays
 * unapproved until an admin approves it.
 */
export function approvedNetworkSubnetCidrs(
  routes: readonly RouteRecord[],
): string[] {
  const result = new Set<string>();
  for (const route of routes) {
    if (route.kind === "subnet" && route.state === "approved") {
      result.add(normalizeCidr(route.cidr));
    }
  }
  return [...result].sort();
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
  /** `device_declared` CIDRs in the device's own config (pending or approved). */
  declaredCidrs: string[];
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
  /**
   * Peer-observed CIDRs that no device in the network has approved. Peers
   * advertise the whole network's routes, so this is not about *this* device's
   * approvals (see `approvedNetworkSubnetCidrs`).
   */
  unapprovedObservedCidrs: string[];
  /** Approved CIDRs the client does not report (push pending or broken). */
  missingCidrs: string[];
  reportedExitNode: boolean;
  unmanagedInstances: ReportedInstance[];
  /** Peers advertising routes that EasyPlane does not know as devices. */
  unknownPeers: PeerObservation[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

/**
 * Reads a route report stored in `devices.reported_state`. Reports written by
 * older builds lack fields added later; filling them with empty values keeps
 * the API response valid instead of failing serialisation for the whole
 * network.
 */
export function normalizeRouteReport(raw: unknown): RouteReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const report = raw as Record<string, unknown>;
  return {
    approvedCidrs: stringArray(report.approvedCidrs),
    declaredCidrs: stringArray(report.declaredCidrs),
    configuredCidrs: stringArray(report.configuredCidrs),
    observedCidrs: stringArray(report.observedCidrs),
    unapprovedCidrs: stringArray(report.unapprovedCidrs),
    unapprovedObservedCidrs: stringArray(report.unapprovedObservedCidrs),
    missingCidrs: stringArray(report.missingCidrs),
    reportedExitNode: report.reportedExitNode === true,
    unmanagedInstances: objectArray(report.unmanagedInstances).map((item) => ({
      instanceId: String(item.instanceId ?? ""),
      networkName: String(item.networkName ?? ""),
      hostname: String(item.hostname ?? ""),
      proxyCidrs: stringArray(item.proxyCidrs),
      exitNode: item.exitNode === true,
      unmanaged: item.unmanaged !== false,
      removable: item.removable === true,
    })),
    unknownPeers: objectArray(report.unknownPeers).map((item) => ({
      ipv4: String(item.ipv4 ?? ""),
      hostname: String(item.hostname ?? ""),
      proxyCidrs: stringArray(item.proxyCidrs),
      ...(typeof item.deviceId === "string" ? { deviceId: item.deviceId } : {}),
    })),
  };
}

/**
 * Compares what the device claims to route with what the control plane
 * approved. EasyTier reports proxy CIDRs per instance in CollectNetworkInfo, so
 * a locally started instance shows up even though it cannot be stopped from
 * here.
 *
 * A `device_declared` CIDR (pending or approved) is *expected*: there is a
 * proposal for it, so it is not reported as unapproved drift. A rejected
 * declaration is not expected and still appears as unapproved.
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
  const declared = declaredSubnetCidrs(input.approvals, input.deviceId);
  // Own config is judged against what this device may route...
  const expected = new Set([...approved, ...declared]);
  // ...but `observed` comes from peers, which advertise *their* routes (and the
  // rest of the network's). A peer CIDR is unapproved only when no device has an
  // approved row for it. This device's own declaration is included too, because
  // peers echo our advertisement back; a peer's pending/rejected proposal is
  // deliberately *not* included and stays unapproved.
  const expectedObserved = new Set([
    ...approvedNetworkSubnetCidrs(input.approvals),
    ...declared,
  ]);
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
      if (!expected.has(cidr)) unapproved.add(cidr);
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
  const unapprovedObserved = [...observed].filter(
    (cidr) => !expectedObserved.has(cidr),
  );

  return {
    approvedCidrs: approved,
    declaredCidrs: declared,
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
  // Peer reports describe this device, but a peer's route table also carries
  // the other members' routes. Compare against every device's approved subnets
  // (plus this device's own pending declaration, which peers echo back) so a
  // legitimate route of another router is not flagged here either.
  const expected = new Set([
    ...approvedNetworkSubnetCidrs(approvals),
    ...declaredSubnetCidrs(approvals, deviceId),
  ]);
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
      .filter((cidr) => !expected.has(cidr))
      .sort(),
  };
}
