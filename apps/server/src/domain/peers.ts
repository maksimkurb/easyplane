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
}

/**
 * Compiles the `peer_urls` of one device from the network's peer list.
 *
 * - a device-backed entry contributes every advertised endpoint of an
 *   **approved hub**, except the target device itself (by `device_id` and, as a
 *   second check, by `machine_id`);
 * - a raw URL is pushed verbatim, unless it is linked to the target device;
 * - invalid URLs are dropped (they would make `gen_config` fail on the client);
 * - de-duplication is by trailing-slash-insensitive URL key, preserving the
 *   network's peer order and each device's endpoint order.
 *
 * A device that is the only (or the current) hub therefore gets an empty list:
 * it is the listener, and must never dial its own advertised endpoint.
 */
export function compilePeerUrls(input: CompilePeerUrlsInput): string[] {
  const targetId = input.targetDeviceId;
  const targetMachineId = input.targetMachineId;
  const urls: string[] = [];
  const seen = new Set<string>();

  const isTarget = (deviceId: string | null | undefined, machineId?: string) => {
    if (deviceId && deviceId === targetId) return true;
    return Boolean(targetMachineId && machineId && machineId === targetMachineId);
  };

  const add = (value: string) => {
    if (!isValidPeerUrl(value)) return;
    const key = peerUrlKey(value);
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    urls.push(value.trim());
  };

  for (const entry of input.entries) {
    if (entry.url !== null) {
      if (isTarget(entry.deviceId, entry.device?.machineId)) continue;
      add(entry.url);
      continue;
    }
    const device = entry.device;
    if (!device) continue;
    if (device.state !== "approved" || !device.isHub) continue;
    if (isTarget(device.id, device.machineId)) continue;
    for (const endpoint of device.advertisedEndpoints) add(endpoint);
  }
  return urls;
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
