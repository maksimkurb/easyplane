import { acl, common, manage } from "@easyplane/proto";

/**
 * Conversion between the JSON shape EasyTier's `pbjson` build produces for
 * `api.manage.NetworkConfig` and our `manage.NetworkConfig` objects.
 *
 * Why this exists: the EasyTier GUI encodes config share links as
 *   zlib( JSON of NetworkConfig )
 * but with two twists that are easy to get wrong (and are *not* what a naive
 * "urlsafe base64 of the protobuf JSON" implementation does):
 *
 *  1. `share_link_service.rs::map_config_json` replaces every **top level** key
 *     with its protobuf field number (as a decimal string) before compressing.
 *     Nested messages keep their snake_case field names.
 *  2. The JSON comes from `pbjson_build` with
 *     `preserve_proto_field_names()`, so keys are snake_case, enums are names
 *     (`"Manual"`, `"Allow"`), 64-bit integers are strings and `bytes` are
 *     base64. Optional fields are omitted when unset; repeated fields are
 *     omitted when empty.
 *
 * Reference: easytier-contrib/easytier-ohrs/src/config/services/share_link_service.rs
 * and easytier-proto/src/api.rs at the pinned commit 81487c363a5677….
 */

type FieldKind =
  | "string"
  | "bool"
  | "int32"
  | "uint32"
  | "int64"
  | "uint64"
  | "bytes"
  | "enum"
  | "message";

export interface FieldSpec {
  /** proto (snake_case) name, which is the pbjson key */
  protoName: string;
  /** camelCase name used by ts-proto */
  name: string;
  kind: FieldKind;
  /** proto field number; only populated for NetworkConfig top-level fields */
  number?: number;
  repeated?: boolean;
  message?: string;
  enumObject?: Record<string, string | number>;
}

const enumObject = (value: object): Record<string, string | number> =>
  value as unknown as Record<string, string | number>;

const MESSAGES: Record<string, FieldSpec[]> = {
  NetworkConfig: [
    { protoName: "instance_id", name: "instanceId", kind: "string", number: 1 },
    { protoName: "dhcp", name: "dhcp", kind: "bool", number: 2 },
    { protoName: "virtual_ipv4", name: "virtualIpv4", kind: "string", number: 3 },
    { protoName: "network_length", name: "networkLength", kind: "int32", number: 4 },
    { protoName: "hostname", name: "hostname", kind: "string", number: 5 },
    { protoName: "network_name", name: "networkName", kind: "string", number: 6 },
    { protoName: "network_secret", name: "networkSecret", kind: "string", number: 7 },
    {
      protoName: "networking_method",
      name: "networkingMethod",
      kind: "enum",
      number: 8,
      enumObject: enumObject(manage.NetworkingMethod),
    },
    {
      protoName: "public_server_url",
      name: "publicServerUrl",
      kind: "string",
      number: 9,
    },
    { protoName: "peer_urls", name: "peerUrls", kind: "string", number: 10, repeated: true },
    { protoName: "proxy_cidrs", name: "proxyCidrs", kind: "string", number: 11, repeated: true },
    { protoName: "enable_vpn_portal", name: "enableVpnPortal", kind: "bool", number: 12 },
    {
      protoName: "vpn_portal_listen_port",
      name: "vpnPortalListenPort",
      kind: "int32",
      number: 13,
    },
    {
      protoName: "vpn_portal_client_network_addr",
      name: "vpnPortalClientNetworkAddr",
      kind: "string",
      number: 14,
    },
    {
      protoName: "vpn_portal_client_network_len",
      name: "vpnPortalClientNetworkLen",
      kind: "int32",
      number: 15,
    },
    { protoName: "advanced_settings", name: "advancedSettings", kind: "bool", number: 16 },
    {
      protoName: "listener_urls",
      name: "listenerUrls",
      kind: "string",
      number: 17,
      repeated: true,
    },
    { protoName: "latency_first", name: "latencyFirst", kind: "bool", number: 19 },
    { protoName: "dev_name", name: "devName", kind: "string", number: 20 },
    { protoName: "use_smoltcp", name: "useSmoltcp", kind: "bool", number: 21 },
    { protoName: "disable_ipv6", name: "disableIpv6", kind: "bool", number: 47 },
    { protoName: "enable_kcp_proxy", name: "enableKcpProxy", kind: "bool", number: 22 },
    { protoName: "disable_kcp_input", name: "disableKcpInput", kind: "bool", number: 23 },
    { protoName: "disable_p2p", name: "disableP2p", kind: "bool", number: 24 },
    { protoName: "bind_device", name: "bindDevice", kind: "bool", number: 25 },
    { protoName: "no_tun", name: "noTun", kind: "bool", number: 26 },
    { protoName: "enable_exit_node", name: "enableExitNode", kind: "bool", number: 27 },
    { protoName: "relay_all_peer_rpc", name: "relayAllPeerRpc", kind: "bool", number: 28 },
    { protoName: "multi_thread", name: "multiThread", kind: "bool", number: 29 },
    {
      protoName: "enable_relay_network_whitelist",
      name: "enableRelayNetworkWhitelist",
      kind: "bool",
      number: 30,
    },
    {
      protoName: "relay_network_whitelist",
      name: "relayNetworkWhitelist",
      kind: "string",
      number: 31,
      repeated: true,
    },
    {
      protoName: "enable_manual_routes",
      name: "enableManualRoutes",
      kind: "bool",
      number: 32,
    },
    { protoName: "routes", name: "routes", kind: "string", number: 33, repeated: true },
    { protoName: "exit_nodes", name: "exitNodes", kind: "string", number: 34, repeated: true },
    {
      protoName: "proxy_forward_by_system",
      name: "proxyForwardBySystem",
      kind: "bool",
      number: 35,
    },
    { protoName: "disable_encryption", name: "disableEncryption", kind: "bool", number: 36 },
    { protoName: "enable_socks5", name: "enableSocks5", kind: "bool", number: 37 },
    { protoName: "socks5_port", name: "socks5Port", kind: "int32", number: 38 },
    {
      protoName: "disable_udp_hole_punching",
      name: "disableUdpHolePunching",
      kind: "bool",
      number: 39,
    },
    { protoName: "mtu", name: "mtu", kind: "int32", number: 40 },
    {
      protoName: "mapped_listeners",
      name: "mappedListeners",
      kind: "string",
      number: 41,
      repeated: true,
    },
    { protoName: "enable_magic_dns", name: "enableMagicDns", kind: "bool", number: 42 },
    { protoName: "enable_private_mode", name: "enablePrivateMode", kind: "bool", number: 43 },
    { protoName: "enable_quic_proxy", name: "enableQuicProxy", kind: "bool", number: 45 },
    { protoName: "disable_quic_input", name: "disableQuicInput", kind: "bool", number: 46 },
    { protoName: "quic_listen_port", name: "quicListenPort", kind: "int32", number: 50 },
    {
      protoName: "port_forwards",
      name: "portForwards",
      kind: "message",
      number: 48,
      repeated: true,
      message: "PortForwardConfig",
    },
    {
      protoName: "disable_sym_hole_punching",
      name: "disableSymHolePunching",
      kind: "bool",
      number: 49,
    },
    { protoName: "p2p_only", name: "p2pOnly", kind: "bool", number: 51 },
    {
      protoName: "data_compress_algo",
      name: "dataCompressAlgo",
      kind: "enum",
      number: 52,
      enumObject: enumObject(common.CompressionAlgoPb),
    },
    {
      protoName: "encryption_algorithm",
      name: "encryptionAlgorithm",
      kind: "string",
      number: 53,
    },
    {
      protoName: "disable_tcp_hole_punching",
      name: "disableTcpHolePunching",
      kind: "bool",
      number: 54,
    },
    {
      protoName: "secure_mode",
      name: "secureMode",
      kind: "message",
      number: 55,
      message: "SecureModeConfig",
    },
    { protoName: "acl", name: "acl", kind: "message", number: 56, message: "Acl" },
    { protoName: "credential_file", name: "credentialFile", kind: "string", number: 57 },
    { protoName: "lazy_p2p", name: "lazyP2p", kind: "bool", number: 58 },
    { protoName: "need_p2p", name: "needP2p", kind: "bool", number: 59 },
    {
      protoName: "instance_recv_bps_limit",
      name: "instanceRecvBpsLimit",
      kind: "uint64",
      number: 60,
    },
    { protoName: "disable_upnp", name: "disableUpnp", kind: "bool", number: 61 },
    {
      protoName: "ipv6_public_addr_provider",
      name: "ipv6PublicAddrProvider",
      kind: "bool",
      number: 62,
    },
    {
      protoName: "ipv6_public_addr_auto",
      name: "ipv6PublicAddrAuto",
      kind: "bool",
      number: 63,
    },
    {
      protoName: "ipv6_public_addr_prefix",
      name: "ipv6PublicAddrPrefix",
      kind: "string",
      number: 64,
    },
    { protoName: "disable_relay_data", name: "disableRelayData", kind: "bool", number: 65 },
    {
      protoName: "enable_udp_broadcast_relay",
      name: "enableUdpBroadcastRelay",
      kind: "bool",
      number: 66,
    },
    { protoName: "socket_mark", name: "socketMark", kind: "uint32", number: 67 },
    {
      protoName: "peers",
      name: "peers",
      kind: "message",
      number: 68,
      repeated: true,
      message: "NetworkPeerConfig",
    },
    {
      protoName: "vpn_portal_config",
      name: "vpnPortalConfig",
      kind: "message",
      number: 69,
      message: "VpnPortalConfig",
    },
    {
      protoName: "managed_credentials",
      name: "managedCredentials",
      kind: "message",
      number: 71,
      repeated: true,
      message: "ManagedCredentialConfig",
    },
  ],
  NetworkPeerConfig: [
    { protoName: "uri", name: "uri", kind: "string" },
    { protoName: "peer_public_key", name: "peerPublicKey", kind: "string" },
  ],
  PortForwardConfig: [
    { protoName: "bind_ip", name: "bindIp", kind: "string" },
    { protoName: "bind_port", name: "bindPort", kind: "uint32" },
    { protoName: "dst_ip", name: "dstIp", kind: "string" },
    { protoName: "dst_port", name: "dstPort", kind: "uint32" },
    { protoName: "proto", name: "proto", kind: "string" },
  ],
  VpnPortalConfig: [
    { protoName: "wireguard_listen", name: "wireguardListen", kind: "string" },
    {
      protoName: "wireguard_private_key",
      name: "wireguardPrivateKey",
      kind: "string",
    },
    {
      protoName: "clients",
      name: "clients",
      kind: "message",
      repeated: true,
      message: "VpnPortalClientConfig",
    },
  ],
  VpnPortalClientConfig: [
    { protoName: "name", name: "name", kind: "string" },
    { protoName: "virtual_ip", name: "virtualIp", kind: "string" },
    { protoName: "groups", name: "groups", kind: "string", repeated: true },
  ],
  ManagedCredentialConfig: [
    { protoName: "credential_id", name: "credentialId", kind: "string" },
    { protoName: "credential_secret", name: "credentialSecret", kind: "string" },
    { protoName: "groups", name: "groups", kind: "string", repeated: true },
    { protoName: "allow_relay", name: "allowRelay", kind: "bool" },
    { protoName: "allowed_proxy_cidrs", name: "allowedProxyCidrs", kind: "string", repeated: true },
    { protoName: "expiry_unix", name: "expiryUnix", kind: "int64" },
    { protoName: "reusable", name: "reusable", kind: "bool" },
  ],
  SecureModeConfig: [
    { protoName: "enabled", name: "enabled", kind: "bool" },
    { protoName: "local_private_key", name: "localPrivateKey", kind: "string" },
    { protoName: "local_public_key", name: "localPublicKey", kind: "string" },
  ],
  Acl: [
    { protoName: "acl_v1", name: "aclV1", kind: "message", message: "AclV1" },
  ],
  AclV1: [
    {
      protoName: "chains",
      name: "chains",
      kind: "message",
      repeated: true,
      message: "Chain",
    },
    { protoName: "group", name: "group", kind: "message", message: "GroupInfo" },
  ],
  Chain: [
    { protoName: "name", name: "name", kind: "string" },
    {
      protoName: "chain_type",
      name: "chainType",
      kind: "enum",
      enumObject: enumObject(acl.ChainType),
    },
    { protoName: "description", name: "description", kind: "string" },
    { protoName: "enabled", name: "enabled", kind: "bool" },
    {
      protoName: "rules",
      name: "rules",
      kind: "message",
      repeated: true,
      message: "Rule",
    },
    {
      protoName: "default_action",
      name: "defaultAction",
      kind: "enum",
      enumObject: enumObject(acl.Action),
    },
  ],
  Rule: [
    { protoName: "name", name: "name", kind: "string" },
    { protoName: "description", name: "description", kind: "string" },
    { protoName: "priority", name: "priority", kind: "uint32" },
    { protoName: "enabled", name: "enabled", kind: "bool" },
    {
      protoName: "protocol",
      name: "protocol",
      kind: "enum",
      enumObject: enumObject(acl.Protocol),
    },
    { protoName: "ports", name: "ports", kind: "string", repeated: true },
    { protoName: "source_ips", name: "sourceIps", kind: "string", repeated: true },
    {
      protoName: "destination_ips",
      name: "destinationIps",
      kind: "string",
      repeated: true,
    },
    { protoName: "source_ports", name: "sourcePorts", kind: "string", repeated: true },
    {
      protoName: "action",
      name: "action",
      kind: "enum",
      enumObject: enumObject(acl.Action),
    },
    { protoName: "rate_limit", name: "rateLimit", kind: "uint32" },
    { protoName: "burst_limit", name: "burstLimit", kind: "uint32" },
    { protoName: "stateful", name: "stateful", kind: "bool" },
    {
      protoName: "source_groups",
      name: "sourceGroups",
      kind: "string",
      repeated: true,
    },
    {
      protoName: "destination_groups",
      name: "destinationGroups",
      kind: "string",
      repeated: true,
    },
  ],
  GroupInfo: [
    {
      protoName: "declares",
      name: "declares",
      kind: "message",
      repeated: true,
      message: "GroupIdentity",
    },
    { protoName: "members", name: "members", kind: "string", repeated: true },
  ],
  GroupIdentity: [
    { protoName: "group_name", name: "groupName", kind: "string" },
    { protoName: "group_secret", name: "groupSecret", kind: "string" },
  ],
};

export const NETWORK_CONFIG_FIELDS = MESSAGES.NetworkConfig!;

/** NetworkConfig top-level field name (snake_case) -> proto field number. */
export const NETWORK_CONFIG_FIELD_NUMBERS: Readonly<Record<string, number>> =
  Object.fromEntries(
    NETWORK_CONFIG_FIELDS.map((field) => [field.protoName, field.number!]),
  );

/** Field number (decimal string) -> NetworkConfig top-level field name. */
export const NETWORK_CONFIG_FIELD_NAMES: Readonly<Record<string, string>> =
  Object.fromEntries(
    NETWORK_CONFIG_FIELDS.map((field) => [String(field.number), field.protoName]),
  );

function enumName(
  enumObject: Record<string, string | number>,
  value: number,
): string | undefined {
  const name = enumObject[value];
  return typeof name === "string" ? name : undefined;
}

function convertOut(
  value: unknown,
  field: FieldSpec,
  path: string,
): unknown {
  switch (field.kind) {
    case "bool":
    case "string":
      return value;
    case "int32":
    case "uint32":
      return value;
    case "int64":
    case "uint64":
      return typeof value === "bigint" ? value.toString() : String(value);
    case "bytes":
      if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
      return value;
    case "enum": {
      if (typeof value !== "number") return value;
      const name = enumName(field.enumObject!, value);
      if (name === undefined) {
        throw new Error(`${path}: unknown enum value ${value}`);
      }
      return name;
    }
    case "message":
      if (typeof value !== "object" || value === null) return value;
      return toPbjsonValue(value as Record<string, unknown>, field.message!, path);
  }
}

function convertIn(
  value: unknown,
  field: FieldSpec,
  path: string,
): unknown {
  switch (field.kind) {
    case "bool":
    case "string":
    case "int32":
    case "uint32":
      return value;
    case "int64":
    case "uint64":
      return typeof value === "string" ? BigInt(value) : BigInt(value as number);
    case "bytes":
      return typeof value === "string" ? new Uint8Array(Buffer.from(value, "base64")) : value;
    case "enum": {
      if (typeof value === "number") return value;
      if (typeof value !== "string") {
        throw new Error(`${path}: expected an enum name`);
      }
      const number = field.enumObject![value];
      if (typeof number !== "number") {
        throw new Error(`${path}: unknown enum value "${value}"`);
      }
      return number;
    }
    case "message":
      if (typeof value !== "object" || value === null) return value;
      return fromPbjsonValue(value as Record<string, unknown>, field.message!, path);
  }
}

function toPbjsonValue(
  value: Record<string, unknown>,
  messageName: string,
  path = messageName,
): Record<string, unknown> {
  const fields = MESSAGES[messageName];
  if (!fields) throw new Error(`unknown message ${messageName}`);
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = value[field.name];
    if (raw === undefined || raw === null) continue;
    const fieldPath = `${path}.${field.protoName}`;
    if (field.repeated) {
      const list = raw as unknown[];
      if (list.length === 0) continue;
      output[field.protoName] = list.map((entry) => convertOut(entry, field, fieldPath));
      continue;
    }
    // pbjson omits proto3 default scalars, so a `false`/`0`/`""` value would
    // disappear; that is harmless (and matches upstream) but keep explicit
    // false for booleans whose default is not "unset": proto3 `optional bool`
    // is presence-tracked, so an explicit false must be serialised.
    if (field.kind === "bool" && raw === false) {
      output[field.protoName] = false;
      continue;
    }
    if (field.kind === "string" && raw === "" && !isProto3Optional(field)) continue;
    output[field.protoName] = convertOut(raw, field, fieldPath);
  }
  return output;
}

/**
 * `optional` fields in api_manage.proto are presence-tracked (`Option<T>`), and
 * pbjson serialises `Some(false)` / `Some("")`. Non-optional message fields are
 * absent when unset.
 */
function isProto3Optional(field: FieldSpec): boolean {
  // Everything in NetworkConfig that is not a message or a repeated field is
  // declared `optional` in the pinned proto.
  return field.kind !== "message" && field.kind !== "enum";
}

function fromPbjsonValue(
  value: Record<string, unknown>,
  messageName: string,
  path = messageName,
): Record<string, unknown> {
  const fields = MESSAGES[messageName];
  if (!fields) throw new Error(`unknown message ${messageName}`);
  const output: Record<string, unknown> = {};
  const known = new Set(fields.map((field) => field.protoName));
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      // Forward compatibility: a newer client may know fields we do not. Keep
      // them out of the typed object; callers surface this through warnings.
      continue;
    }
  }
  for (const field of fields) {
    const raw = value[field.protoName];
    const fieldPath = `${path}.${field.protoName}`;
    if (raw === undefined || raw === null) {
      if (field.repeated) output[field.name] = [];
      continue;
    }
    if (field.repeated) {
      if (!Array.isArray(raw)) {
        throw new Error(`${fieldPath}: expected an array`);
      }
      output[field.name] = raw.map((entry) => convertIn(entry, field, fieldPath));
      continue;
    }
    output[field.name] = convertIn(raw, field, fieldPath);
  }
  return output;
}

export function toPbjson(config: manage.NetworkConfig): Record<string, unknown> {
  return toPbjsonValue(
    config as unknown as Record<string, unknown>,
    "NetworkConfig",
  );
}

export function fromPbjson(
  json: Record<string, unknown>,
): manage.NetworkConfig {
  return fromPbjsonValue(json, "NetworkConfig") as unknown as manage.NetworkConfig;
}

/** Recursively converts an ACL (used by tests and the export path). */
export function aclToPbjson(value: acl.Acl): Record<string, unknown> {
  return toPbjsonValue(value as unknown as Record<string, unknown>, "Acl");
}

export function aclFromPbjson(value: Record<string, unknown>): acl.Acl {
  return fromPbjsonValue(value, "Acl") as unknown as acl.Acl;
}

/** Empty config with the repeated fields ts-proto requires. */
export function emptyNetworkConfig(): manage.NetworkConfig {
  return {
    peerUrls: [],
    proxyCidrs: [],
    listenerUrls: [],
    relayNetworkWhitelist: [],
    routes: [],
    exitNodes: [],
    mappedListeners: [],
    portForwards: [],
    peers: [],
    managedCredentials: [],
  };
}
