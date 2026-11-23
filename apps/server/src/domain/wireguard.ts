import { instance, manage } from "@easyplane/proto";

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
      virtualIp: client.virtualIpv4,
      groups: [...client.groups],
    })),
  };
}

function clientFingerprint(client: manage.VpnPortalClientConfig): string {
  return [
    client.name,
    client.virtualIp,
    // Order inside `groups` is not meaningful; sort so a reordering alone is
    // not reported as drift.
    [...(client.groups ?? [])].sort().join(","),
  ].join("|");
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
  const remoteClients = (remote.clients ?? []).map(clientFingerprint).sort();
  const desiredClients = (desired.clients ?? []).map(clientFingerprint).sort();
  if (remoteClients.length !== desiredClients.length) return false;
  return remoteClients.every((value, index) => value === desiredClients[index]);
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
