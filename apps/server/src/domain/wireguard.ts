import { instance, manage } from "@easyplane/proto";

import { parseCidr, parseIpv4 } from "./ip.js";

/**
 * WireGuard portal: easyplane-managed ordinary WireGuard clients that join the
 * overlay through one hub's built-in WireGuard server.
 *
 * Facts from the pinned client (`easytier-core` 2.6.4-81487c36):
 *
 * - `VpnPortalConfig` is part of `NetworkConfig` (field 69) and carries
 *   `wireguard_listen` (a `SocketAddr` string), a required
 *   `wireguard_private_key` (base64 of 32 raw bytes) and the client list.
 * - `wireguard_private_key` is mandatory: the portal refuses to start without
 *   it ("WireGuard portal requires a dedicated private key"). Every client
 *   keypair is derived from that master key and the client name via HKDF
 *   (`derive_named_key`), so the panel must generate and store the master key
 *   but never needs to keep per-client secrets.
 * - A client's `groups` must each be declared in the instance's ACL
 *   (`acl.group.declares`); anything else fails the whole portal start
 *   ("uses unknown ACL group"). The push compiler therefore emits the portal
 *   client tags as declarations for the hub and filters the pushed list to
 *   actually declared groups.
 * - `VpnPortalRpc.GetVpnPortalInfo` is registered on the same config-server
 *   session at domain "" (the client registers the complete management
 *   surface there), so the panel can read live state and the ready-made
 *   `client_config` text from the hub.
 */

/** Port the panel proposes when the portal is enabled for the first time. */
export const DEFAULT_WIREGUARD_PORT = 11013;

/** Upstream `MAX_VPN_PORTAL_CLIENTS`. */
export const MAX_WIREGUARD_CLIENTS_PER_HUB = 128;

/**
 * The first EasyTier release with the per-client WireGuard portal
 * (`vpn_portal_config{wireguard_private_key, clients[]}` and runtime
 * add/remove). Owner-stated threshold, confirmed against the v2.7.0 release
 * notes (PRs #2502/#2514/#2537) and the upstream tree: v2.6.4 has no
 * `vpn_portal_config` field in `NetworkConfig` at all and only understands the
 * CLI form `--vpn-portal wg://host:port/<client CIDR>`.
 */
export const PER_CLIENT_PORTAL_MIN_VERSION = "2.7.0";

/**
 * Portal configuration generations understood by EasyTier:
 *
 * - `per-client` (>= 2.7.0): one named client per address, per-client keys
 *   derived from a master key, tags/ACL groups and live per-client state.
 * - `legacy` (< 2.7.0, e.g. 2.6.4 on OpenWrt): one `client_cidr` prefix and
 *   one ready-made client config, no names/keys per client. 2.6.x has no
 *   protocol field for the portal, so it must be configured on the device
 *   itself (`--vpn-portal`); the panel only stores the intent, shows the exact
 *   flag and reads `GetVpnPortalInfo` back.
 * - `unknown`: the reported version string could not be parsed; never push
 *   per-client state, behave like legacy and show a hint.
 */
export type WireguardPortalMode = "per-client" | "legacy" | "unknown";

/**
 * What the panel knows about a hub's portal right now:
 * `disabled` (not enabled here), `starting` (enabled, no probe yet),
 * `running`, `unsupported` (this EasyTier build has no WireGuard support or
 * cannot understand per-client portal state) and `error`.
 */
export type WireguardPortalState =
  | "disabled"
  | "starting"
  | "running"
  | "unsupported"
  | "error";

/** Default legacy (`client_cidr`) pool suggested by the panel. */
export const DEFAULT_LEGACY_CLIENT_CIDR = "10.14.14.0/24";

export interface EasyTierVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses the leading `major.minor.patch` of a client version string. Build
 * metadata (`2.6.4-8428a89d`, `2.7.0-nightly.<date>`) is ignored, so a
 * pre-release build of 2.7.0 counts as 2.7.0.
 */
export function parseEasyTierVersion(value: string | null | undefined): EasyTierVersion | null {
  if (typeof value !== "string") return null;
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map((part) =>
    Number.parseInt(part!, 10),
  );
  if (![major, minor, patch].every((part) => Number.isFinite(part))) return null;
  return { major: major!, minor: minor!, patch: patch! };
}

/** Numeric comparison of two version strings; null when either is unparseable. */
export function compareEasyTierVersions(left: string, right: string): number | null {
  const a = parseEasyTierVersion(left);
  const b = parseEasyTierVersion(right);
  if (!a || !b) return null;
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Portal generation implied by the reported EasyTier version alone. */
export function portalModeForVersion(version: string | null | undefined): WireguardPortalMode {
  const parsed = parseEasyTierVersion(version);
  if (!parsed) return "unknown";
  const atLeastMin =
    parsed.major > 2 ||
    (parsed.major === 2 && parsed.minor >= 7) ||
    (parsed.major === 2 && parsed.minor === 7 && parsed.patch >= 0);
  // Anything older than 2.7.0 (including 1.x) uses the legacy CIDR portal.
  return atLeastMin ? "per-client" : "legacy";
}

export interface PortalModeInput {
  /** `devices.easytier_version` as reported by the heartbeat. */
  version: string | null | undefined;
  /**
   * `GetNetworkInstanceConfig` echoed a per-client `vpn_portal_config` back
   * after a push. That is authoritative even if the version string is odd or
   * empty (the device obviously understands the field).
   */
  reportedPerClientPortal?: boolean;
  /**
   * Last probe said the client answered `VpnPortalInfo.clients[]` (a
   * per-client-only message), which also proves the newer generation.
   */
  probedPerClientClients?: boolean;
}

/**
 * Resolves the portal generation for a hub. Behaviour beats the version
 * string: a device that echoes the per-client field or reports named clients
 * is per-client even when `easytier_version` is empty or unparseable.
 */
export function resolvePortalMode(input: PortalModeInput): WireguardPortalMode {
  if (input.reportedPerClientPortal || input.probedPerClientClients) {
    return "per-client";
  }
  return portalModeForVersion(input.version);
}

/** The legacy `--vpn-portal` URL 2.6.x parses: `wg://<listen>/<client CIDR>`. */
export function legacyPortalUrl(port: number, clientCidr: string): string {
  return `wg://0.0.0.0:${port}/${clientCidr}`;
}

/**
 * Ready-to-paste device configuration for a legacy portal (2.6.x). The panel
 * cannot push a portal to these builds over the config-server protocol: the
 * released 2.6.4 `NetworkConfig` has no portal field, so the value lives in
 * the instance file/CLI instead. Both forms are equivalent; the TOML form is
 * shown because OpenWrt users usually edit the instance file.
 */
export function legacyPortalConfigHint(port: number, clientCidr: string): {
  url: string;
  cli: string;
  toml: string;
} {
  const url = legacyPortalUrl(port, clientCidr);
  return {
    url,
    cli: `easytier-core --vpn-portal ${url}`,
    toml: [
      "[vpn_portal_config]",
      `client_cidr = ${JSON.stringify(clientCidr)}`,
      `wireguard_listen = ${JSON.stringify(`0.0.0.0:${port}`)}`,
    ].join("\n"),
  };
}

/**
 * Hard facts reported by 2.6.4's `GetVpnPortalInfo` (read from the v2.6.4
 * sources):
 *
 * - no `wireguard` feature compiled in → `vpn_type = "null"`, empty config;
 * - feature present but the portal was not started → a *successful* response
 *   whose `client_config` starts with `ERROR: Wireguard VPN Portal Not
 *   Started` (this is what `easytier-cli vpn-portal` prints on prod h-1).
 */
export function legacyPortalReplyError(clientConfig: string | undefined): string | null {
  const value = (clientConfig ?? "").trim();
  return value.startsWith("ERROR:") ? value : null;
}

/** Last known portal state persisted on the device's `reported_state`. */
export interface PortalProbeSnapshot {
  state: WireguardPortalState;
  /** Human-readable reason; never contains a key or a client config. */
  error: string | null;
  /** `VpnPortalInfo.vpn_type` as reported (`"null"` for builds without the feature). */
  vpnType: string | null;
  /** `VpnPortalInfo.connected_clients.length` in the legacy generation. */
  connectedClients: number;
  /** `true` when the hub answered with per-client entries. */
  perClientClients: boolean;
  checkedAt: string;
}

export type WireguardClientState =
  | "online"
  | "connecting"
  | "offline"
  | "error"
  | "unknown";

export interface WireguardPortalClient {
  name: string;
  virtualIpv4: string;
  /** EasyTier ACL group names; only those the hub's ACL declares. */
  groups: string[];
}

export interface WireguardPortalSettings {
  /** UDP port; null means the portal is disabled. */
  listenPort: number | null;
  /** `base64(32-byte X25519 private key)`; the portal master key. */
  privateKey: string | null;
  /**
   * Prefix length of the instance's virtual network. EasyTier >= 2.7.0 parses
   * a client's `virtual_ip` as an `Ipv4Inet` (`addr/prefix`) and rejects a
   * bare address: it becomes a `/32`, whose first and last address are the
   * client itself, and the portal refuses to start with "has an unusable
   * virtual IP".
   */
  networkPrefixLength: number;
}

/**
 * `virtualIp` exactly as EasyTier >= 2.7.0 expects it: the allocated host
 * address with the **network's** prefix length (`10.144.144.8/24`).
 */
export function formatPortalVirtualIp(
  virtualIpv4: string,
  networkPrefixLength: number,
): string {
  return `${virtualIpv4}/${networkPrefixLength}`;
}

export function isValidWireguardPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** EasyTier parses `wireguard_listen` as a `SocketAddr`. */
export function wireguardListenAddress(port: number): string {
  return `0.0.0.0:${port}`;
}

/**
 * Builds the `vpn_portal_config` for a hub. Returns undefined when the portal
 * is disabled so the field is omitted from the pushed config entirely.
 */
export function buildVpnPortalConfig(
  settings: WireguardPortalSettings,
  clients: readonly WireguardPortalClient[],
): manage.VpnPortalConfig | undefined {
  if (
    settings.listenPort === null ||
    settings.privateKey === null ||
    settings.privateKey.trim() === ""
  ) {
    return undefined;
  }
  return {
    wireguardListen: wireguardListenAddress(settings.listenPort),
    wireguardPrivateKey: settings.privateKey,
    clients: clients.map((client) => ({
      name: client.name,
      virtualIp: formatPortalVirtualIp(
        client.virtualIpv4,
        settings.networkPrefixLength,
      ),
      groups: [...client.groups],
    })),
  };
}

/**
 * Why EasyTier would refuse this portal client address, or null. Mirrors
 * `validate_runtime_compatibility` (v2.7.1, `gateway/vpn_portal/runtime.rs`):
 * a client may not use the hub's own overlay address nor the first/last
 * address of its prefix (which a bare address without a prefix makes
 * impossible, because a /32 has the client itself as first and last).
 */
export function portalVirtualIpProblem(input: {
  virtualIpv4: string;
  prefixLength: number;
  hubVirtualIpv4: string | null;
}): string | null {
  let parsed;
  try {
    parsed = parseCidr(`${input.virtualIpv4}/${input.prefixLength}`);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  let address;
  try {
    address = parseIpv4(input.virtualIpv4);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (address === parsed.base) return "is the network address of its prefix";
  if (address === parsed.base + parsed.size - 1) {
    return "is the broadcast address of its prefix";
  }
  if (input.hubVirtualIpv4 !== null) {
    try {
      if (parseIpv4(input.hubVirtualIpv4) === address) {
        return "is the hub's own overlay address";
      }
    } catch {
      // An unparseable hub address cannot collide.
    }
  }
  return null;
}

/**
 * Normalises one `VpnPortalClientConfig.virtual_ip` so a bare address and the
 * `addr/prefix` form compare equal on the address, and two prefixes only
 * compare when both sides carry one. This keeps the drift check stable if a
 * client echoes the field in the other generation's shape.
 */
function normalizePortalVirtualIp(value: string | undefined): {
  address: string;
  prefix: string | null;
} {
  const raw = (value ?? "").trim();
  const slash = raw.indexOf("/");
  if (slash === -1) return { address: raw, prefix: null };
  return { address: raw.slice(0, slash), prefix: raw.slice(slash + 1) };
}

function clientFingerprint(client: manage.VpnPortalClientConfig): string {
  const virtualIp = normalizePortalVirtualIp(client.virtualIp);
  return [
    client.name,
    virtualIp.address,
    virtualIp.prefix ?? "",
    // Order inside `groups` is not meaningful; sort so a reordering alone is
    // not reported as drift.
    [...(client.groups ?? [])].sort().join(","),
  ].join("|");
}

function samePortalClient(
  left: manage.VpnPortalClientConfig,
  right: manage.VpnPortalClientConfig,
): boolean {
  if (left.name !== right.name) return false;
  const leftIp = normalizePortalVirtualIp(left.virtualIp);
  const rightIp = normalizePortalVirtualIp(right.virtualIp);
  if (leftIp.address !== rightIp.address) return false;
  // A client that echoes the bare address (older build) is not drift for the
  // same address; a real prefix change is.
  if (
    leftIp.prefix !== null &&
    rightIp.prefix !== null &&
    leftIp.prefix !== rightIp.prefix
  ) {
    return false;
  }
  const leftGroups = [...(left.groups ?? [])].sort().join(",");
  const rightGroups = [...(right.groups ?? [])].sort().join(",");
  return leftGroups === rightGroups;
}

function portalClientsMatch(
  remote: readonly manage.VpnPortalClientConfig[],
  desired: readonly manage.VpnPortalClientConfig[],
): boolean {
  const byName = new Map(remote.map((client) => [client.name, client]));
  if (byName.size !== desired.length) return false;
  return desired.every((client) => {
    const match = byName.get(client.name);
    return match !== undefined && samePortalClient(match, client);
  });
}

/**
 * Semantic comparison of the exposed portal settings. The private key is
 * compared only by presence: the hub reports it back, but a value mismatch is
 * the same class of drift as a missing key, and the key must never reach a log.
 */
export function vpnPortalConfigMatches(
  remote: manage.VpnPortalConfig | undefined,
  desired: manage.VpnPortalConfig | undefined,
): boolean {
  if (!desired) return remote === undefined;
  if (!remote) return false;
  if ((remote.wireguardListen ?? "") !== desired.wireguardListen) return false;
  const remoteHasKey = (remote.wireguardPrivateKey ?? "") !== "";
  const desiredHasKey = (desired.wireguardPrivateKey ?? "") !== "";
  if (remoteHasKey !== desiredHasKey) return false;
  return portalClientsMatch(remote.clients ?? [], desired.clients ?? []);
}

/**
 * Human-readable drift reasons. Never includes the WireGuard private key or a
 * client config (which contains a private key).
 */
export function describeVpnPortalMismatch(
  remote: manage.VpnPortalConfig | undefined,
  desired: manage.VpnPortalConfig | undefined,
): string[] {
  if (!desired && !remote) return [];
  if (!desired) return ["vpnPortalConfig: portal enabled on the client, disabled here"];
  if (!remote) return ["vpnPortalConfig: missing on the client"];
  const reasons: string[] = [];
  if ((remote.wireguardListen ?? "") !== desired.wireguardListen) {
    reasons.push(
      `vpnPortalConfig.wireguardListen: client=${JSON.stringify(remote.wireguardListen)} desired=${JSON.stringify(desired.wireguardListen)}`,
    );
  }
  if (((remote.wireguardPrivateKey ?? "") === "") !== ((desired.wireguardPrivateKey ?? "") === "")) {
    reasons.push("vpnPortalConfig.wireguardPrivateKey: presence differs");
  }
  const remoteClients = (remote.clients ?? []).map(clientFingerprint).sort();
  const desiredClients = (desired.clients ?? []).map(clientFingerprint).sort();
  if (JSON.stringify(remoteClients) !== JSON.stringify(desiredClients)) {
    reasons.push(
      `vpnPortalConfig.clients: client=${JSON.stringify(remoteClients)} desired=${JSON.stringify(desiredClients)}`,
    );
  }
  return reasons;
}

export function mapPortalState(
  state: instance.VpnPortalClientState | undefined,
): WireguardClientState {
  switch (state) {
    case instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_ONLINE:
      return "online";
    case instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_CONNECTING:
      return "connecting";
    case instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_OFFLINE:
      return "offline";
    case instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_ERROR:
      return "error";
    default:
      return "unknown";
  }
}

export interface WireguardPortalStatus {
  name: string;
  state: WireguardClientState;
  endpoint: string | null;
  tunnelIp: string | null;
  peerId: number | null;
  error: string | null;
}

/**
 * Maps a `VpnPortalInfo` response to per-client status. `clientConfig` is
 * deliberately dropped: it embeds a private key and is fetched separately for
 * a single authorised download.
 */
export function portalStatuses(
  info: instance.VpnPortalInfo | undefined,
): WireguardPortalStatus[] {
  if (!info) return [];
  return (info.clients ?? []).map((client) => ({
    name: client.name,
    state: mapPortalState(client.state),
    endpoint: client.endpoint ?? null,
    tunnelIp: client.tunnelIp ?? null,
    peerId: client.peerId ?? null,
    error: client.error ?? null,
  }));
}

/** The ready-made WireGuard config for one client, or null when absent. */
export function findClientConfig(
  info: instance.VpnPortalInfo | undefined,
  name: string,
): string | null {
  const client = (info?.clients ?? []).find((entry) => entry.name === name);
  const config = client?.clientConfig ?? "";
  return config.trim() === "" ? null : config;
}

/** The portal listener address the hub reported, when present. */
export function portalListener(info: instance.VpnPortalInfo | undefined): string | null {
  const listener = info?.listener ?? "";
  return listener.trim() === "" ? null : listener;
}

/**
 * Classifies a `GetVpnPortalInfo` reply without trusting any generation
 * assumption:
 *
 * - `vpn_type = "null"` → the build has no WireGuard support at all;
 * - named clients present → per-client generation, portal is running;
 * - `client_config` starts with `ERROR:` → the portal exists in the build but
 *   is not started (2.6.4 answers exactly that);
 * - otherwise → portal running in whichever generation the version implies.
 */
export function interpretPortalProbe(
  info: instance.VpnPortalInfo | undefined,
  mode: WireguardPortalMode,
  checkedAt = new Date().toISOString(),
): PortalProbeSnapshot {
  const vpnType = (info?.vpnType ?? "").trim();
  const perClientClients = (info?.clients ?? []).length > 0;
  const connectedClients = (info?.connectedClients ?? []).length;
  const replyError = legacyPortalReplyError(info?.clientConfig);
  if (vpnType === "null") {
    return {
      state: "unsupported",
      error:
        "this EasyTier build has no WireGuard support (vpn_type = null); install a build compiled with the wireguard feature",
      vpnType,
      connectedClients,
      perClientClients,
      checkedAt,
    };
  }
  if (!info) {
    return {
      state: "error",
      error: "the hub returned no WireGuard portal information",
      vpnType: null,
      connectedClients,
      perClientClients,
      checkedAt,
    };
  }
  if (perClientClients) {
    return {
      state: "running",
      error: null,
      vpnType: vpnType || "wireguard",
      connectedClients,
      perClientClients,
      checkedAt,
    };
  }
  if (replyError) {
    // 2.6.x reports "ERROR: Wireguard VPN Portal Not Started" — the feature is
    // there, only the instance was started without the portal flag.
    const unsupported = /not compiled|not supported|unavailable/i.test(replyError);
    return {
      state: unsupported ? "unsupported" : "error",
      error: replyError,
      vpnType: vpnType || null,
      connectedClients,
      perClientClients,
      checkedAt,
    };
  }
  if (mode === "legacy") {
    // A legacy placeholder config without ERROR text means the portal is up.
    const hasConfig = (info.clientConfig ?? "").trim() !== "";
    return {
      state: hasConfig ? "running" : "error",
      error: hasConfig ? null : "the hub has not generated the legacy WireGuard client config",
      vpnType: vpnType || null,
      connectedClients,
      perClientClients,
      checkedAt,
    };
  }
  return {
    state: "running",
    error: null,
    vpnType: vpnType || null,
    connectedClients,
    perClientClients,
    checkedAt,
  };
}

/** Legacy generation: the shared ready-made config served by the portal. */
export function legacyClientConfig(
  info: instance.VpnPortalInfo | undefined,
): string | null {
  const raw = info?.clientConfig ?? "";
  const value = raw.trim();
  if (value === "" || value.startsWith("ERROR:")) return null;
  return raw;
}

/** Names of the legacy portal's connected clients (2.6.x string form). */
export function legacyConnectedClients(
  info: instance.VpnPortalInfo | undefined,
): string[] {
  return [...(info?.connectedClients ?? [])];
}

/**
 * Portal generation for a device row: the version string plus anything the
 * panel has already learned about it (a per-client echo, named clients in a
 * probe). Shared by the push path, the WireGuard service and the device DTO so
 * all three agree.
 */
export function portalModeForDevice(device: {
  easytierVersion: string | null | undefined;
  reportedState: unknown;
}): WireguardPortalMode {
  const state =
    device.reportedState && typeof device.reportedState === "object"
      ? (device.reportedState as Record<string, unknown>)
      : {};
  const snapshot = readPortalSnapshot(state);
  return resolvePortalMode({
    version: device.easytierVersion,
    reportedPerClientPortal: state.wgPortalMode === "per-client",
    probedPerClientClients: snapshot?.perClientClients === true,
  });
}

/**
 * Did the device reject the pushed **portal** config? EasyTier applies the
 * whole `NetworkConfig` at once, so a bad portal field (for example
 * "VPN portal client keen-h2 has an unusable virtual IP") makes the instance
 * fail to start. That must never be retried blindly (it keeps the hub down)
 * nor ignored (the network stays broken): the panel records the exact device
 * message, drops the portal field and pushes the rest once.
 */
export function isPortalApplyError(message: string): boolean {
  return /vpn[\s_-]?portal|wireguard\s+portal|unusable virtual ip/i.test(message);
}

/** Marker for "the device rejected this exact portal config". */
export interface PortalApplyError {
  /** Exact device message, already truncated for storage. */
  message: string;
  /** Fingerprint of the desired config that included the portal. */
  fingerprint: string;
  at: string;
}

export function readPortalApplyError(reportedState: unknown): PortalApplyError | null {
  if (!reportedState || typeof reportedState !== "object") return null;
  const raw = (reportedState as Record<string, unknown>).wgPortalApplyError;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.message !== "string" ||
    value.message === "" ||
    typeof value.fingerprint !== "string" ||
    value.fingerprint === ""
  ) {
    return null;
  }
  return {
    message: value.message,
    fingerprint: value.fingerprint,
    at: typeof value.at === "string" ? value.at : new Date(0).toISOString(),
  };
}

/** Persists a rejection together with an `error` portal snapshot. */
export function withPortalApplyError(
  reportedState: Record<string, unknown>,
  error: PortalApplyError,
): Record<string, unknown> {
  return {
    ...reportedState,
    wgPortalApplyError: error,
    wgPortal: {
      state: "error",
      error: error.message,
      vpnType: null,
      connectedClients: 0,
      perClientClients: false,
      checkedAt: error.at,
    } satisfies PortalProbeSnapshot,
  };
}

/** Clears the rejection marker (manual retry; the rows themselves stay). */
export function withoutPortalApplyError(
  reportedState: Record<string, unknown>,
): Record<string, unknown> {
  if (!("wgPortalApplyError" in reportedState)) return reportedState;
  const { wgPortalApplyError: _marker, ...rest } = reportedState;
  return rest;
}

/** Reads the persisted probe snapshot from `devices.reported_state`. */export function readPortalSnapshot(reportedState: unknown): PortalProbeSnapshot | null {
  if (!reportedState || typeof reportedState !== "object") return null;
  const raw = (reportedState as Record<string, unknown>).wgPortal;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const state = value.state;
  if (
    state !== "disabled" &&
    state !== "starting" &&
    state !== "running" &&
    state !== "unsupported" &&
    state !== "error"
  ) {
    return null;
  }
  const stringOrNull = (entry: unknown): string | null =>
    typeof entry === "string" && entry !== "" ? entry : null;
  const integer = (entry: unknown): number =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : 0;
  return {
    state,
    error: stringOrNull(value.error),
    vpnType: stringOrNull(value.vpnType),
    connectedClients: integer(value.connectedClients),
    perClientClients: value.perClientClients === true,
    checkedAt: stringOrNull(value.checkedAt) ?? new Date(0).toISOString(),
  };
}

/** Merges a probe snapshot into `reported_state` (keeps unrelated report keys). */
export function withPortalSnapshot(
  reportedState: Record<string, unknown>,
  snapshot: PortalProbeSnapshot,
  mode: WireguardPortalMode,
): Record<string, unknown> {
  return {
    ...reportedState,
    wgPortal: snapshot,
    // The detected generation is also persisted so a probe result that proves
    // per-client support survives a later empty version string.
    wgPortalMode: mode,
  };
}

/** Does `cidr` overlap any of `others`? Used to validate the legacy pool. */
export function cidrOverlapsAny(cidr: string, others: readonly string[]): boolean {
  let candidate;
  try {
    candidate = parseCidr(cidr);
  } catch {
    return true;
  }
  for (const other of others) {
    let parsed;
    try {
      parsed = parseCidr(other);
    } catch {
      continue;
    }
    const start = Math.max(candidate.base, parsed.base);
    const end = Math.min(
      candidate.base + candidate.size - 1,
      parsed.base + parsed.size - 1,
    );
    if (start <= end) return true;
  }
  return false;
}
