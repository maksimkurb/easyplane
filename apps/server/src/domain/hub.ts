import { formatIpv4, parseIpv4 } from "./ip.js";
import { peerUrlKey, validatePeerUrl } from "./peers.js";

/** Port EasyTier binds when a hub has no explicit listen port. */
export const DEFAULT_HUB_LISTEN_PORT = 11010;

export interface HubListenerDevice {
  isHub: boolean;
  listenPort?: number | null;
}

export interface HubEndpointDevice extends HubListenerDevice {
  externalPort?: number | null;
  advertisedEndpoints: readonly string[];
  /** Public IPv4 addresses last observed by the topology collector. */
  publicIps?: readonly string[];
}

/** A port is valid inside the full TCP/UDP range. */
export function isValidHubPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** The port EasyTier actually binds: the stored value or the default. */
export function effectiveHubListenPort(
  listenPort: number | null | undefined,
): number {
  return listenPort ?? DEFAULT_HUB_LISTEN_PORT;
}

/**
 * The port other devices dial: the external port when set, otherwise the
 * listen port (Plex-style "same port inside and outside").
 */
export function effectiveHubExternalPort(
  device: Pick<HubListenerDevice, "isHub" | "listenPort"> & {
    externalPort?: number | null;
  },
): number {
  return device.externalPort ?? effectiveHubListenPort(device.listenPort);
}

/**
 * The `listener_urls` compiled for a device. A hub always binds tcp and udp on
 * its listen port (EasyTier's tunnel schemes), in addition to any listeners an
 * operator stored in the revision. Non-hubs keep the stored list unchanged.
 */
export function effectiveListenerUrls(
  stored: readonly string[],
  device: HubListenerDevice,
): string[] {
  const listeners = [...stored];
  if (!device.isHub) return listeners;
  const port = effectiveHubListenPort(device.listenPort);
  const seen = new Set(listeners.map((entry) => peerUrlKey(entry)));
  for (const scheme of ["tcp", "udp"] as const) {
    const url = `${scheme}://0.0.0.0:${port}`;
    const key = peerUrlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    listeners.push(url);
  }
  return listeners;
}

/**
 * Public IPv4 addresses only. Private, loopback, link-local, CGNAT and
 * multicast/reserved ranges are skipped: advertising them would make peers
 * dial an address that cannot work across the internet.
 */
export function normalizePublicIpv4List(
  values: readonly string[],
): string[] {
  const addresses = new Set<number>();
  for (const value of values) {
    let address: number;
    try {
      address = parseIpv4(value);
    } catch {
      continue;
    }
    if (!isPublicIpv4(address)) continue;
    addresses.add(address);
  }
  return [...addresses].sort((left, right) => left - right).map(formatIpv4);
}

function isPublicIpv4(address: number): boolean {
  const first = (address >>> 24) & 0xff;
  const second = (address >>> 16) & 0xff;
  if (first === 0 || first === 10 || first === 127) return false;
  if (first === 169 && second === 254) return false; // link-local
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 100 && second >= 64 && second <= 127) return false; // CGNAT
  if (first >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/**
 * Endpoints advertised automatically for a hub: one tcp URL per public IPv4
 * it reported through EasyTier STUN, using the external port (or the listen
 * port). These are what other devices dial after router port-forwarding.
 */
export function autoHubEndpoints(
  device: HubEndpointDevice,
  publicIps: readonly string[] = device.publicIps ?? [],
): string[] {
  if (!device.isHub) return [];
  const port = effectiveHubExternalPort(device);
  return normalizePublicIpv4List(publicIps).map(
    (address) => `tcp://${address}:${port}`,
  );
}

function addValidEndpoint(result: string[], seen: Set<string>, value: string) {
  try {
    const validated = validatePeerUrl(value);
    const key = peerUrlKey(validated);
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    result.push(validated);
  } catch {
    // An invalid stored endpoint is dropped here, exactly like the peer
    // compiler does; it must never break every push in the network.
  }
}

/**
 * Every endpoint other devices dial for a hub: the automatically detected
 * public addresses first, then the operator's extra addresses (DDNS names,
 * other IPs, ws/wss/quic/wg URLs). De-duplicated by URL, trailing-slash
 * insensitive.
 */
export function effectiveHubEndpoints(
  device: HubEndpointDevice,
  publicIps: readonly string[] = device.publicIps ?? [],
): string[] {
  const endpoints: string[] = [];
  const seen = new Set<string>();
  for (const endpoint of autoHubEndpoints(device, publicIps)) {
    addValidEndpoint(endpoints, seen, endpoint);
  }
  for (const endpoint of device.advertisedEndpoints) {
    addValidEndpoint(endpoints, seen, endpoint);
  }
  return endpoints;
}

function sameUrlSet(left: readonly string[], right: readonly string[]): boolean {
  const leftKeys = new Set(left.map(peerUrlKey));
  const rightKeys = new Set(right.map(peerUrlKey));
  if (leftKeys.size !== rightKeys.size) return false;
  for (const key of leftKeys) if (!rightKeys.has(key)) return false;
  return true;
}

/**
 * Whether new public addresses actually change what peers dial. Used by the
 * topology collector to repush peer lists only when the effective set changes,
 * not on every probe.
 */
export function hubPublicIpsChanged(
  device: HubEndpointDevice,
  previous: readonly string[],
  next: readonly string[],
): boolean {
  if (!device.isHub) return false;
  return !sameUrlSet(
    autoHubEndpoints(device, previous),
    autoHubEndpoints(device, next),
  );
}
