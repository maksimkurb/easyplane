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

export interface RouteReport {
  approvedCidrs: string[];
  reportedCidrs: string[];
  /** Reported CIDRs that are not approved for this device. */
  unapprovedCidrs: string[];
  /** Approved CIDRs the client does not report (push pending or broken). */
  missingCidrs: string[];
  reportedExitNode: boolean;
  unmanagedInstances: ReportedInstance[];
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
  instances: readonly ReportedInstance[];
}): RouteReport {
  const approved = approvedSubnetCidrs(input.approvals, input.deviceId);
  const approvedSet = new Set(approved);
  const reported = new Set<string>();
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
        reported.add(raw);
        unapproved.add(raw);
        continue;
      }
      reported.add(cidr);
      if (!approvedSet.has(cidr)) unapproved.add(cidr);
    }
    if (instance.exitNode) reportedExitNode = true;
  }

  return {
    approvedCidrs: approved,
    reportedCidrs: [...reported].sort(),
    unapprovedCidrs: [...unapproved].sort(),
    missingCidrs: approved.filter((cidr) => !reported.has(cidr)),
    reportedExitNode,
    unmanagedInstances: unmanaged,
  };
}

/** True when every CIDR a device wants to serve is a valid, non-overlapping route. */
export function validateSubnetRequest(
  cidr: string,
  existing: readonly RouteRecord[],
): { cidr: string } {
  const normalized = normalizeCidr(cidr);
  if (normalized === "0.0.0.0/0") {
    throw new Error(
      "0.0.0.0/0 is an exit node, not a subnet route; request an exit node instead",
    );
  }
  for (const route of existing) {
    if (route.kind !== "subnet" || route.state === "rejected") continue;
    if (normalizeCidr(route.cidr) === normalized) continue;
    if (cidrsOverlap(route.cidr, normalized)) {
      throw new Error(
        `route ${normalized} overlaps ${route.cidr}, which is already requested or approved in this network`,
      );
    }
  }
  return { cidr: normalized };
}
