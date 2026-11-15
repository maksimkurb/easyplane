import { z } from "zod";

import type { DeviceState } from "../db/schema.js";

/**
 * Peer URL schemes accepted by the pinned easytier-core (2.6.4-81487c36).
 *
 * `easytier/src/tunnel/mod.rs` parses the scheme as `TunnelScheme`
 * (unix/http/https/ring/txt/srv) or as `IpScheme` (tcp/udp/ws/wss/quic/wg/
 * faketcp); a peer URL is a `url::Url`, so the scheme must be one of those and
 * the host part must parse. Optional ports fall back to the core's default
 * port per protocol, so `tcp://host` is valid too.
 */
export const PEER_URL_SCHEMES = [
  "tcp",
  "udp",
  "ws",
  "wss",
  "quic",
  "wg",
  "faketcp",
  "unix",
  "http",
  "https",
  "ring",
  "txt",
  "srv",
] as const;

export type PeerUrlScheme = (typeof PEER_URL_SCHEMES)[number];

const SCHEMES = new Set<string>(PEER_URL_SCHEMES);

/** Schemes whose URL must carry a (non-empty) host. */
const HOST_REQUIRED = new Set<string>([
  "tcp",
  "udp",
  "ws",
  "wss",
  "quic",
  "wg",
  "faketcp",
  "http",
  "https",
  "ring",
  "txt",
  "srv",
]);

export const PEER_URL_MAX_LENGTH = 512;

/**
 * Validates a peer/endpoint URL exactly as far as the control plane can: the
 * scheme must be one the pinned core accepts and the rest must parse as a URL.
 * No DNS resolution and no IP normalisation — the URL is kept verbatim.
 */
export function validatePeerUrl(value: string): string {
  const url = value.trim();
  if (url.length === 0) throw new Error("peer URL is empty");
  if (url.length > PEER_URL_MAX_LENGTH) {
    throw new Error(`peer URL is longer than ${PEER_URL_MAX_LENGTH} characters`);
  }
  if (/\s/.test(url)) throw new Error(`peer URL "${url}" contains whitespace`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`peer URL "${url}" is not a valid URL`);
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!SCHEMES.has(scheme)) {
    throw new Error(
      `peer URL scheme "${scheme}" is not supported; use one of ${PEER_URL_SCHEMES.join(", ")}`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("peer URLs must not contain credentials");
  }
  if (HOST_REQUIRED.has(scheme) && parsed.hostname === "") {
    throw new Error(`peer URL "${url}" has no host`);
  }
  return url;
}

export function isValidPeerUrl(value: string): boolean {
  try {
    validatePeerUrl(value);
    return true;
  } catch {
    return false;
  }
}

export const peerUrlSchema = z
  .string()
  .min(1)
  .max(PEER_URL_MAX_LENGTH)
  .transform((value, ctx) => {
    try {
      return validatePeerUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "invalid peer URL",
      });
      return z.NEVER;
    }
  });

/**
 * Comparison key for de-duplication and drift checks. EasyTier's
 * `Url::to_string` appends a trailing "/" to `tcp://host:port`, so the key
 * ignores trailing slashes.
 */
export function peerUrlKey(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export interface PeerCompilerDevice {
  id: string;
  machineId: string;
  state: DeviceState;
  isHub: boolean;
  advertisedEndpoints: readonly string[];
}

/**
 * One row of the network's ordered peer list, already resolved to its device
 * (device-backed entry) or carrying a raw URL.
 */
export interface PeerCompilerEntry {
  /** Device reference: the entry's device, or the link on a raw URL. */
  deviceId: string | null;
  /** Raw external URL; null for a device-backed entry. */
  url: string | null;
  /** Referenced device for a device-backed entry (or the link target). */
  device?: PeerCompilerDevice | null;
}

export interface CompilePeerUrlsInput {
  /** Device the config is compiled for. */
  targetDeviceId: string;
  /**
   * The target's `machine_id`. Identity is checked by both: a device row that
   * was deleted and re-enrolled keeps its peer entry only by id.
   */
  targetMachineId?: string;
  entries: readonly PeerCompilerEntry[];
  /**
   * Endpoints of the bundled rendezvous node. They are appended after the
   * network's own entries, never excluded for any device (the node is not a
   * device in this network) and de-duplicated against hub/raw URLs.
   */
  rendezvousEndpoints?: readonly string[];
}

/** Where one compiled peer URL came from. */
export type PeerSource = "hub" | "external" | "rendezvous";

export interface CompiledPeer {
  url: string;
  source: PeerSource;
}

/**
 * Compiles the `peer_urls` of one device from the network's peer list and the
 * bundled rendezvous endpoints, keeping each URL's source for the UI/audit.
 *
 * - a device-backed entry contributes every advertised endpoint of an
 *   **approved hub**, except the target device itself (by `device_id` and, as a
 *   second check, by `machine_id`);
 * - a raw URL is pushed verbatim, unless it is linked to the target device;
 * - configured rendezvous endpoints are appended last and are never
 *   self-excluded (the rendezvous node is not one of this network's devices);
 * - invalid URLs are dropped (they would make `gen_config` fail on the client);
 * - de-duplication is by trailing-slash-insensitive URL key, preserving the
 *   network's peer order, each device's endpoint order and the rendezvous
 *   order. A URL already present from the network list keeps that source.
 */
export function compilePeerList(input: CompilePeerUrlsInput): CompiledPeer[] {
  const targetId = input.targetDeviceId;
  const targetMachineId = input.targetMachineId;
  const peers: CompiledPeer[] = [];
  const seen = new Set<string>();

  const isTarget = (deviceId: string | null | undefined, machineId?: string) => {
    if (deviceId && deviceId === targetId) return true;
    return Boolean(targetMachineId && machineId && machineId === targetMachineId);
  };

  const add = (value: string, source: PeerSource) => {
    if (!isValidPeerUrl(value)) return;
    const key = peerUrlKey(value);
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    peers.push({ url: value.trim(), source });
  };

  for (const entry of input.entries) {
    if (entry.url !== null) {
      if (isTarget(entry.deviceId, entry.device?.machineId)) continue;
      add(entry.url, "external");
      continue;
    }
    const device = entry.device;
    if (!device) continue;
    if (device.state !== "approved" || !device.isHub) continue;
    if (isTarget(device.id, device.machineId)) continue;
    for (const endpoint of device.advertisedEndpoints) add(endpoint, "hub");
  }
  for (const endpoint of input.rendezvousEndpoints ?? []) {
    add(endpoint, "rendezvous");
  }
  return peers;
}

/**
 * The `peer_urls` list pushed to the client. See `compilePeerList` for the
 * rules; this wrapper keeps the existing call sites and tests simple.
 */
export function compilePeerUrls(input: CompilePeerUrlsInput): string[] {
  return compilePeerList(input).map((peer) => peer.url);
}

/** Stable de-duplication for endpoint lists stored on a device. */
export function dedupePeerUrls(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const validated = validatePeerUrl(value);
    const key = peerUrlKey(validated);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(validated);
  }
  return result;
}
