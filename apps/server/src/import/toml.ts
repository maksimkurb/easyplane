import { common, manage } from "@easyplane/proto";
import { parse, stringify } from "smol-toml";

import {
  aclFromPbjson,
  aclToPbjson,
  emptyNetworkConfig,
} from "./pbjson.js";

/**
 * EasyTier TOML <-> `api.manage.NetworkConfig`.
 *
 * The TOML model is `easytier-core/src/config/toml.rs` (`struct Config`) at the
 * pinned commit. It is *not* the CLI's flag list: it is the file format that
 * `easytier-core -c config.toml` and the GUI's "export" use:
 *
 *   instance_id / hostname / ipv4 = "10.144.144.10/24" / dhcp
 *   [network_identity] network_name, network_secret
 *   [[peer]] uri, peer_public_key
 *   listeners = ["tcp://0.0.0.0:11010"]
 *   [[proxy_network]] cidr, mapped_cidr, allow
 *   [[port_forward]] bind_addr, dst_addr, proto
 *   routes, exit_nodes, [flags], [secure_mode], [acl], ...
 *
 * The NetworkConfig side follows `NetworkConfigExt::gen_config` /
 * `new_from_config` in `easytier-core/src/config/api_input.rs`, which is the
 * exact conversion the client performs when a control plane pushes a config.
 * Fields that EasyPlane manages through its own workflow (proxy CIDRs, exit
 * nodes, ACLs/credentials) are parsed for round-tripping but reported as
 * not imported; see `ImportService`.
 */

export interface ParsedConfig {
  config: manage.NetworkConfig;
  /** Non-fatal problems: data was dropped or normalised. */
  warnings: string[];
  /** Features present in the source that EasyPlane does not manage. */
  unsupported: string[];
  /** True when a network secret (or credential-mode private key) was found. */
  secretPresent: boolean;
  /** Credential mode cannot be represented by an EasyPlane network. */
  credentialMode: boolean;
}

const TOML_KNOWN_KEYS = new Set([
  "netns",
  "hostname",
  "instance_name",
  "instance_id",
  "ipv4",
  "ipv6",
  "ipv6_public_addr_provider",
  "ipv6_public_addr_auto",
  "ipv6_public_addr_prefix",
  "dhcp",
  "network_identity",
  "listeners",
  "mapped_listeners",
  "exit_nodes",
  "peer",
  "proxy_network",
  "vpn_portal_config",
  "routes",
  "socks5_proxy",
  "port_forward",
  "secure_mode",
  "flags",
  "acl",
  "tcp_whitelist",
  "udp_whitelist",
  "stun_servers",
  "tcp_stun_servers",
  "stun_servers_v6",
  "credential_file",
  "managed_credentials",
  "source",
]);

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected a table`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path}: expected a string`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${path}: expected a boolean`);
  return value;
}

function optionalInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${path}: expected an integer`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array of strings`);
  return value.map((entry, index) => asString(entry, `${path}[${index}]`));
}

function tableArray(value: unknown, path: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array of tables`);
  return value.map((entry, index) => asRecord(entry, `${path}[${index}]`));
}

function splitIpv4(value: string, path: string): { address: string; prefix: number } {
  const [address, prefixText, ...rest] = value.split("/");
  if (rest.length > 0 || !address) throw new Error(`${path}: invalid IPv4 CIDR "${value}"`);
  const prefix = prefixText === undefined ? 24 : Number(prefixText);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    throw new Error(`${path}: invalid IPv4 address "${address}"`);
  }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`${path}: invalid IPv4 prefix "${prefixText}"`);
  }
  return { address, prefix };
}

const FLAG_MAP: Record<
  string,
  { field: keyof manage.NetworkConfig; invert?: boolean }
> = {
  no_tun: { field: "noTun" },
  disable_p2p: { field: "disableP2p" },
  latency_first: { field: "latencyFirst" },
  accept_dns: { field: "enableMagicDns" },
  mtu: { field: "mtu" },
  enable_exit_node: { field: "enableExitNode" },
  disable_encryption: { field: "disableEncryption" },
  p2p_only: { field: "p2pOnly" },
  need_p2p: { field: "needP2p" },
  lazy_p2p: { field: "lazyP2p" },
  relay_all_peer_rpc: { field: "relayAllPeerRpc" },
  disable_udp_hole_punching: { field: "disableUdpHolePunching" },
  disable_tcp_hole_punching: { field: "disableTcpHolePunching" },
  disable_sym_hole_punching: { field: "disableSymHolePunching" },
  disable_upnp: { field: "disableUpnp" },
  disable_relay_data: { field: "disableRelayData" },
  enable_udp_broadcast_relay: { field: "enableUdpBroadcastRelay" },
  bind_device: { field: "bindDevice" },
  multi_thread: { field: "multiThread" },
  use_smoltcp: { field: "useSmoltcp" },
  enable_kcp_proxy: { field: "enableKcpProxy" },
  disable_kcp_input: { field: "disableKcpInput" },
  enable_quic_proxy: { field: "enableQuicProxy" },
  disable_quic_input: { field: "disableQuicInput" },
  proxy_forward_by_system: { field: "proxyForwardBySystem" },
  dev_name: { field: "devName" },
  instance_recv_bps_limit: { field: "instanceRecvBpsLimit" },
  encryption_algorithm: { field: "encryptionAlgorithm" },
  socket_mark: { field: "socketMark" },
  data_compress_algo: { field: "dataCompressAlgo" },
  private_mode: { field: "enablePrivateMode" },
};

/** EasyTier flags that have no NetworkConfig counterpart at all. */
const UNSUPPORTED_FLAGS = new Set([
  "enable_ipv6",
  "default_protocol",
  "relay_network_whitelist",
  "tld_dns_zone",
  "multi_thread_count",
  "foreign_relay_bps_limit",
  "enable_relay_foreign_network_kcp",
  "enable_relay_foreign_network_quic",
  "disable_relay_kcp",
  "disable_relay_quic",
  "quic_listen_port",
]);

function parseFlags(
  raw: unknown,
  config: manage.NetworkConfig,
  warnings: string[],
  unsupported: string[],
): void {
  if (raw === undefined) return;
  const flags = asRecord(raw, "flags");
  for (const [key, value] of Object.entries(flags)) {
    if (key === "relay_network_whitelist") {
      const whitelist = asString(value, `flags.${key}`);
      config.enableRelayNetworkWhitelist = whitelist !== "*";
      config.relayNetworkWhitelist =
        whitelist === "*" || whitelist === "" ? [] : whitelist.split(/\s+/);
      continue;
    }
    const mapping = FLAG_MAP[key];
    if (!mapping) {
      if (UNSUPPORTED_FLAGS.has(key)) {
        unsupported.push(`flags.${key}`);
        continue;
      }
      warnings.push(`unknown flag "flags.${key}" was ignored`);
      continue;
    }
    switch (mapping.field) {
      case "mtu":
      case "socketMark":
      case "instanceRecvBpsLimit":
        (config[mapping.field] as number | bigint | undefined) =
          mapping.field === "instanceRecvBpsLimit"
            ? BigInt(optionalInteger(value, `flags.${key}`) ?? 0)
            : optionalInteger(value, `flags.${key}`);
        break;
      case "dataCompressAlgo": {
        const number =
          typeof value === "string"
            ? (common.CompressionAlgoPb as unknown as Record<string, number>)[value]
            : optionalInteger(value, `flags.${key}`);
        if (typeof number !== "number") {
          warnings.push(`flags.data_compress_algo value "${String(value)}" was ignored`);
        } else {
          config.dataCompressAlgo = number;
        }
        break;
      }
      case "encryptionAlgorithm":
      case "devName":
        (config[mapping.field] as string | undefined) = asString(value, `flags.${key}`);
        break;
      default:
        (config[mapping.field] as boolean | undefined) = optionalBoolean(
          value,
          `flags.${key}`,
        );
    }
  }
}

export function tomlToNetworkConfig(text: string): ParsedConfig {
  let document: Record<string, unknown>;
  try {
    document = asRecord(parse(text), "config");
  } catch (error) {
    throw new Error(
      `invalid EasyTier TOML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const warnings: string[] = [];
  const unsupported: string[] = [];
  const config = emptyNetworkConfig();

  for (const key of Object.keys(document)) {
    if (!TOML_KNOWN_KEYS.has(key)) {
      warnings.push(`unknown top-level key "${key}" was ignored`);
    }
  }

  config.instanceId = optionalString(document.instance_id, "instance_id");
  config.hostname = optionalString(document.hostname, "hostname");
  config.dhcp = optionalBoolean(document.dhcp, "dhcp");
  if (document.ipv4 !== undefined) {
    const { address, prefix } = splitIpv4(asString(document.ipv4, "ipv4"), "ipv4");
    config.virtualIpv4 = address;
    config.networkLength = prefix;
  }
  if (document.instance_name !== undefined) {
    // Not part of NetworkConfig; surfaced through the suggested network name.
    warnings.push(
      `instance_name "${asString(document.instance_name, "instance_name")}" is only used as a display-name hint`,
    );
  }
  if (document.ipv6 !== undefined || document.ipv6_public_addr_prefix !== undefined) {
    unsupported.push("ipv6 addressing");
  }
  if (document.ipv6_public_addr_provider !== undefined) {
    config.ipv6PublicAddrProvider = optionalBoolean(
      document.ipv6_public_addr_provider,
      "ipv6_public_addr_provider",
    );
  }
  if (document.ipv6_public_addr_auto !== undefined) {
    config.ipv6PublicAddrAuto = optionalBoolean(
      document.ipv6_public_addr_auto,
      "ipv6_public_addr_auto",
    );
  }
  if (document.netns !== undefined) unsupported.push("netns");

  const identity = document.network_identity;
  if (identity === undefined) {
    throw new Error("config has no [network_identity] table");
  }
  const identityTable = asRecord(identity, "network_identity");
  config.networkName = asString(identityTable.network_name, "network_identity.network_name");
  config.networkSecret = optionalString(
    identityTable.network_secret,
    "network_identity.network_secret",
  );

  if (document.peer !== undefined) {
    const peers = tableArray(document.peer, "peer");
    config.peers = peers.map((peer, index) => {
      const uri = asString(peer.uri, `peer[${index}].uri`);
      if (peer.peer_public_key !== undefined) {
        warnings.push(
          `peer[${index}].peer_public_key is not represented by EasyPlane's desired config`,
        );
      }
      return {
        uri,
        peerPublicKey: optionalString(peer.peer_public_key, `peer[${index}].peer_public_key`),
      };
    });
    config.peerUrls = config.peers.map((peer) => peer.uri);
    config.networkingMethod = manage.NetworkingMethod.Manual;
  }

  if (document.listeners !== undefined) {
    config.listenerUrls = stringArray(document.listeners, "listeners");
  }
  if (document.mapped_listeners !== undefined) {
    config.mappedListeners = stringArray(document.mapped_listeners, "mapped_listeners");
    unsupported.push("mapped listeners");
  }
  if (document.exit_nodes !== undefined) {
    config.exitNodes = stringArray(document.exit_nodes, "exit_nodes");
  }
  if (document.routes !== undefined) {
    config.routes = stringArray(document.routes, "routes");
    if (config.routes.length > 0) config.enableManualRoutes = true;
  }

  if (document.proxy_network !== undefined) {
    config.proxyCidrs = tableArray(document.proxy_network, "proxy_network").map(
      (entry, index) => {
        const cidr = asString(entry.cidr, `proxy_network[${index}].cidr`);
        if (entry.allow !== undefined) {
          warnings.push(
            `proxy_network[${index}].allow is not supported by EasyTier's NetworkConfig and was dropped`,
          );
        }
        const mapped = optionalString(entry.mapped_cidr, `proxy_network[${index}].mapped_cidr`);
        return mapped ? `${cidr}->${mapped}` : cidr;
      },
    );
    unsupported.push("proxy CIDRs (managed by EasyPlane route approvals)");
  }

  if (document.port_forward !== undefined) {
    config.portForwards = tableArray(document.port_forward, "port_forward").map(
      (entry, index) => {
        const bind = asString(entry.bind_addr, `port_forward[${index}].bind_addr`);
        const dst = asString(entry.dst_addr, `port_forward[${index}].dst_addr`);
        const proto = optionalString(entry.proto, `port_forward[${index}].proto`) ?? "tcp";
        const bindParts = splitHostPort(bind, `port_forward[${index}].bind_addr`);
        const dstParts = splitHostPort(dst, `port_forward[${index}].dst_addr`);
        return {
          bindIp: bindParts.host,
          bindPort: bindParts.port,
          dstIp: dstParts.host,
          dstPort: dstParts.port,
          proto,
        };
      },
    );
    unsupported.push("port forwarding");
  }

  if (document.vpn_portal_config !== undefined) {
    unsupported.push("VPN portal");
    const portal = asRecord(document.vpn_portal_config, "vpn_portal_config");
    const clients = portal.clients === undefined ? [] : tableArray(portal.clients, "vpn_portal_config.clients");
    config.vpnPortalConfig = {
      wireguardListen: asString(portal.wireguard_listen, "vpn_portal_config.wireguard_listen"),
      wireguardPrivateKey: optionalString(
        portal.wireguard_private_key,
        "vpn_portal_config.wireguard_private_key",
      ),
      clients: clients.map((client, index) => ({
        name: asString(client.name, `vpn_portal_config.clients[${index}].name`),
        virtualIp: asString(
          client.virtual_ip,
          `vpn_portal_config.clients[${index}].virtual_ip`,
        ),
        groups:
          client.groups === undefined
            ? []
            : stringArray(client.groups, `vpn_portal_config.clients[${index}].groups`),
      })),
    };
  }

  if (document.socks5_proxy !== undefined) {
    config.enableSocks5 = true;
    const url = asString(document.socks5_proxy, "socks5_proxy");
    const port = Number(url.split(":").pop());
    if (Number.isInteger(port)) config.socks5Port = port;
    unsupported.push("SOCKS5 portal");
  }

  if (document.secure_mode !== undefined) {
    const mode = asRecord(document.secure_mode, "secure_mode");
    config.secureMode = {
      enabled: optionalBoolean(mode.enabled, "secure_mode.enabled") ?? false,
      localPrivateKey: optionalString(mode.local_private_key, "secure_mode.local_private_key"),
      localPublicKey: optionalString(mode.local_public_key, "secure_mode.local_public_key"),
    };
  }

  if (document.acl !== undefined) {
    try {
      config.acl = aclFromPbjson(asRecord(document.acl, "acl"));
    } catch (error) {
      warnings.push(
        `the [acl] table could not be decoded and was dropped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    unsupported.push("ACL (use an EasyPlane policy document)");
  }

  if (document.credential_file !== undefined) {
    config.credentialFile = asString(document.credential_file, "credential_file");
    unsupported.push("credential file");
  }
  if (document.managed_credentials !== undefined) {
    config.managedCredentials = tableArray(
      document.managed_credentials,
      "managed_credentials",
    ).map((entry, index) => ({
      credentialId: asString(entry.credential_id, `managed_credentials[${index}].credential_id`),
      credentialSecret: asString(
        entry.credential_secret,
        `managed_credentials[${index}].credential_secret`,
      ),
      groups:
        entry.groups === undefined
          ? []
          : stringArray(entry.groups, `managed_credentials[${index}].groups`),
      allowRelay: optionalBoolean(entry.allow_relay, `managed_credentials[${index}].allow_relay`) ?? false,
      allowedProxyCidrs:
        entry.allowed_proxy_cidrs === undefined
          ? []
          : stringArray(
              entry.allowed_proxy_cidrs,
              `managed_credentials[${index}].allowed_proxy_cidrs`,
            ),
      expiryUnix:
        entry.expiry_unix === undefined
          ? 0n
          : BigInt(optionalInteger(entry.expiry_unix, `managed_credentials[${index}].expiry_unix`) ?? 0),
      reusable: optionalBoolean(entry.reusable, `managed_credentials[${index}].reusable`),
    }));
    unsupported.push("managed credentials");
  }

  if (document.tcp_whitelist !== undefined || document.udp_whitelist !== undefined) {
    unsupported.push("TCP/UDP whitelists");
  }
  if (
    document.stun_servers !== undefined ||
    document.tcp_stun_servers !== undefined ||
    document.stun_servers_v6 !== undefined
  ) {
    unsupported.push("custom STUN servers");
  }

  parseFlags(document.flags, config, warnings, unsupported);

  if (config.networkingMethod === undefined) {
    config.networkingMethod =
      (config.peerUrls?.length ?? 0) > 0
        ? manage.NetworkingMethod.Manual
        : manage.NetworkingMethod.Standalone;
  }
  if (config.dhcp === undefined) config.dhcp = false;

  const privateKey = config.secureMode?.localPrivateKey;
  const credentialMode =
    Boolean(config.secureMode?.enabled) &&
    (config.networkSecret === undefined || config.networkSecret === "") &&
    Boolean(privateKey);

  if (credentialMode) {
    unsupported.push("credential-mode network (secure_mode.local_private_key)");
  }

  return {
    config,
    warnings,
    unsupported,
    secretPresent: Boolean(config.networkSecret) || Boolean(privateKey),
    credentialMode,
  };
}

function splitHostPort(value: string, path: string): { host: string; port: number } {
  const index = value.lastIndexOf(":");
  if (index <= 0) throw new Error(`${path}: expected host:port`);
  const host = value.slice(0, index).replace(/^\[|\]$/g, "");
  const port = Number(value.slice(index + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${path}: invalid port`);
  }
  return { host, port };
}

export interface TomlExportOptions {
  /** Include the network secret (a config file without it cannot join peers). */
  includeSecret?: boolean;
}

/**
 * Builds an EasyTier TOML document from a NetworkConfig, mirroring
 * `gen_config`'s semantics (a Standalone config ignores peers; PublicServer
 * falls back to `public_server_url`).
 */
export function networkConfigToToml(
  config: manage.NetworkConfig,
  options: TomlExportOptions = {},
): string {
  const includeSecret = options.includeSecret ?? true;
  const document: Record<string, unknown> = {};
  if (config.instanceId) document.instance_id = config.instanceId;
  if (config.hostname) document.hostname = config.hostname;
  document.dhcp = Boolean(config.dhcp);
  if (!config.dhcp && config.virtualIpv4) {
    document.ipv4 = `${config.virtualIpv4}/${config.networkLength ?? 24}`;
  }
  document.network_identity = {
    network_name: config.networkName ?? "",
    ...(includeSecret && config.networkSecret !== undefined
      ? { network_secret: config.networkSecret }
      : {}),
  };

  const method = config.networkingMethod ?? manage.NetworkingMethod.PublicServer;
  let peers: Array<{ uri: string; peer_public_key?: string }> = [];
  if (method === manage.NetworkingMethod.PublicServer) {
    peers = config.peers.length > 0
      ? config.peers.map((peer) => ({
          uri: peer.uri,
          ...(peer.peerPublicKey ? { peer_public_key: peer.peerPublicKey } : {}),
        }))
      : config.publicServerUrl
        ? [{ uri: config.publicServerUrl }]
        : [];
  } else if (method === manage.NetworkingMethod.Manual) {
    peers = config.peers.length > 0
      ? config.peers.map((peer) => ({
          uri: peer.uri,
          ...(peer.peerPublicKey ? { peer_public_key: peer.peerPublicKey } : {}),
        }))
      : config.peerUrls.map((uri) => ({ uri }));
  }
  if (peers.length > 0) document.peer = peers;

  if (config.listenerUrls.length > 0) document.listeners = config.listenerUrls;
  if (config.mappedListeners.length > 0) document.mapped_listeners = config.mappedListeners;
  if (config.exitNodes.length > 0) document.exit_nodes = config.exitNodes;

  if (config.proxyCidrs.length > 0) {
    document.proxy_network = config.proxyCidrs.map((entry) => {
      const [cidr, mapped] = entry.split("->");
      return {
        cidr,
        ...(mapped ? { mapped_cidr: mapped } : {}),
      };
    });
  }

  if (config.enableManualRoutes && config.routes.length > 0) {
    document.routes = config.routes;
  }

  if (config.portForwards.length > 0) {
    document.port_forward = config.portForwards.map((forward) => ({
      bind_addr: `${forward.bindIp}:${forward.bindPort}`,
      dst_addr: `${forward.dstIp}:${forward.dstPort}`,
      proto: forward.proto,
    }));
  }
  if (config.socks5Port !== undefined && config.enableSocks5) {
    document.socks5_proxy = `socks5://0.0.0.0:${config.socks5Port}`;
  }
  if (config.vpnPortalConfig) {
    document.vpn_portal_config = {
      wireguard_listen: config.vpnPortalConfig.wireguardListen,
      ...(config.vpnPortalConfig.wireguardPrivateKey
        ? { wireguard_private_key: config.vpnPortalConfig.wireguardPrivateKey }
        : {}),
      clients: config.vpnPortalConfig.clients.map((client) => ({
        name: client.name,
        virtual_ip: client.virtualIp,
        groups: client.groups,
      })),
    };
  }
  if (config.secureMode) {
    document.secure_mode = {
      enabled: config.secureMode.enabled,
      ...(config.secureMode.localPrivateKey
        ? { local_private_key: config.secureMode.localPrivateKey }
        : {}),
      ...(config.secureMode.localPublicKey
        ? { local_public_key: config.secureMode.localPublicKey }
        : {}),
    };
  }
  if (config.acl) document.acl = aclToPbjson(config.acl);
  if (config.credentialFile) document.credential_file = config.credentialFile;
  if (config.managedCredentials.length > 0) {
    document.managed_credentials = config.managedCredentials.map((credential) => ({
      credential_id: credential.credentialId,
      credential_secret: credential.credentialSecret,
      groups: credential.groups,
      allow_relay: credential.allowRelay,
      allowed_proxy_cidrs: credential.allowedProxyCidrs,
      expiry_unix: Number(credential.expiryUnix),
      ...(credential.reusable !== undefined ? { reusable: credential.reusable } : {}),
    }));
  }

  const flags: Record<string, unknown> = {};
  const setFlag = (key: string, value: unknown, defaultValue: unknown) => {
    if (value !== undefined && value !== defaultValue) flags[key] = value;
  };
  setFlag("no_tun", config.noTun, false);
  setFlag("disable_p2p", config.disableP2p, false);
  setFlag("latency_first", config.latencyFirst, false);
  setFlag("accept_dns", config.enableMagicDns, false);
  setFlag("enable_exit_node", config.enableExitNode, false);
  setFlag("mtu", config.mtu, 1380);
  setFlag("disable_encryption", config.disableEncryption, false);
  setFlag("p2p_only", config.p2pOnly, false);
  setFlag("need_p2p", config.needP2p, false);
  setFlag("lazy_p2p", config.lazyP2p, false);
  setFlag("relay_all_peer_rpc", config.relayAllPeerRpc, false);
  setFlag("bind_device", config.bindDevice, true);
  setFlag("multi_thread", config.multiThread, true);
  setFlag("use_smoltcp", config.useSmoltcp, false);
  setFlag("enable_kcp_proxy", config.enableKcpProxy, false);
  setFlag("disable_kcp_input", config.disableKcpInput, false);
  setFlag("enable_quic_proxy", config.enableQuicProxy, false);
  setFlag("disable_quic_input", config.disableQuicInput, false);
  setFlag("proxy_forward_by_system", config.proxyForwardBySystem, false);
  setFlag("dev_name", config.devName, "");
  setFlag("disable_udp_hole_punching", config.disableUdpHolePunching, false);
  setFlag("disable_tcp_hole_punching", config.disableTcpHolePunching, false);
  setFlag("disable_sym_hole_punching", config.disableSymHolePunching, false);
  setFlag("disable_upnp", config.disableUpnp, false);
  setFlag("disable_relay_data", config.disableRelayData, false);
  setFlag("enable_udp_broadcast_relay", config.enableUdpBroadcastRelay, false);
  setFlag("private_mode", config.enablePrivateMode, false);
  setFlag("encryption_algorithm", config.encryptionAlgorithm, undefined);
  if (config.instanceRecvBpsLimit !== undefined && config.instanceRecvBpsLimit !== 0n) {
    flags.instance_recv_bps_limit = Number(config.instanceRecvBpsLimit);
  }
  if (config.socketMark !== undefined) flags.socket_mark = config.socketMark;
  if (config.dataCompressAlgo !== undefined && config.dataCompressAlgo !== 1) {
    flags.data_compress_algo = "Zstd";
  }
  if (config.relayNetworkWhitelist.length > 0) {
    flags.relay_network_whitelist = config.relayNetworkWhitelist.join(" ");
  } else if (config.enableRelayNetworkWhitelist === false) {
    flags.relay_network_whitelist = "*";
  }
  if (Object.keys(flags).length > 0) document.flags = flags;

  return stringify(document);
}
