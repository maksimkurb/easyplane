import { manage } from "@easyplane/proto";

import {
  desiredConfigSchema,
  normalizeDesiredConfig,
  type DesiredConfig,
} from "../domain/desired-config.js";
import { formatIpv4, parseIpv4 } from "../domain/ip.js";
import { validatePeerUrl } from "../domain/peers.js";

/** Everything EasyPlane needs to create a network from an imported config. */
export interface ImportedNetworkSpec {
  /** Panel display name; editable before commit. */
  name: string;
  /** EasyTier `network_name`; immutable after creation. */
  networkName: string;
  ipv4Cidr: string;
  magicDnsEnabled: boolean;
  defaultConfig: DesiredConfig;
}

export interface DescribeResult {
  spec: ImportedNetworkSpec;
  /** Non-secret config values that will be used, for the preview UI. */
  summary: ImportSummary;
  warnings: string[];
  unsupported: string[];
}

export interface ImportSummary {
  hostname: string | null;
  networkingMethod: string;
  dhcp: boolean;
  virtualIpv4: string | null;
  networkLength: number | null;
  peerUrls: string[];
  listenerUrls: string[];
  routes: string[];
  proxyCidrs: string[];
  exitNodes: string[];
  portForwards: number;
  aclChains: number;
  magicDns: boolean;
}

const METHOD_NAMES: Record<number, DesiredConfig["networkingMethod"]> = {
  [manage.NetworkingMethod.PublicServer]: "publicServer",
  [manage.NetworkingMethod.Manual]: "manual",
  [manage.NetworkingMethod.Standalone]: "standalone",
};

function methodName(value: number | undefined): DesiredConfig["networkingMethod"] {
  if (value === undefined) return "standalone";
  return METHOD_NAMES[value] ?? "standalone";
}

function cidrFromAddress(address: string, prefix: number): string {
  const value = parseIpv4(address);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return `${formatIpv4((value & mask) >>> 0)}/${prefix}`;
}

/**
 * Maps an imported `NetworkConfig` to the EasyPlane network + default device
 * config. This is intentionally lossy where EasyPlane owns the value through a
 * workflow (proxy CIDRs, exit nodes, ACLs, credentials); every dropped field is
 * reported in `unsupported` so the preview never pretends otherwise.
 */
export function describeNetworkConfig(
  config: manage.NetworkConfig,
  hints: { suggestedName?: string | undefined } = {},
): DescribeResult {
  const warnings: string[] = [];
  const unsupported: string[] = [];

  const networkName = (config.networkName ?? "").trim();
  if (networkName === "") {
    throw new Error("the imported config has no network_name");
  }
  if (networkName.length > 128) {
    throw new Error("network_name is longer than 128 characters");
  }

  const dhcp = Boolean(config.dhcp);
  let ipv4Cidr: string;
  if (!dhcp && config.virtualIpv4) {
    const prefix = config.networkLength ?? 24;
    if (prefix < 8 || prefix > 30) {
      throw new Error(
        `network_length ${prefix} cannot be represented as an EasyPlane CIDR (8..30)`,
      );
    }
    ipv4Cidr = cidrFromAddress(config.virtualIpv4, prefix);
  } else {
    const prefix = config.networkLength ?? 24;
    if (prefix < 8 || prefix > 30) {
      throw new Error(
        `network_length ${prefix} cannot be represented as an EasyPlane CIDR (8..30)`,
      );
    }
    ipv4Cidr = cidrFromAddress("10.144.144.0", prefix);
    warnings.push(
      "the source has no fixed virtual IPv4 (DHCP or unset); EasyPlane will allocate fixed addresses in " +
        ipv4Cidr,
    );
  }

  const peers = config.peers ?? [];
  const peerUrls =
    peers.length > 0 ? peers.map((peer) => peer.uri) : [...(config.peerUrls ?? [])];
  if (peers.some((peer) => peer.peerPublicKey)) {
    unsupported.push("peer public keys (NetworkPeerConfig.peer_public_key)");
  }
  for (const peer of peers) {
    try {
      validatePeerUrl(peer.uri);
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : `peer URL "${peer.uri}" is invalid`,
      );
    }
  }
  for (const peerUrl of config.peerUrls ?? []) {
    if (peerUrl.trim() === "") continue;
    try {
      validatePeerUrl(peerUrl);
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : `peer URL "${peerUrl}" is invalid`,
      );
    }
  }

  const relayWhitelist = config.relayNetworkWhitelist ?? [];
  if (relayWhitelist.length > 0 && config.enableRelayNetworkWhitelist === false) {
    warnings.push(
      "relay_network_whitelist is set but enable_relay_network_whitelist is false; EasyPlane enables the whitelist when the list is non-empty",
    );
  }

  const defaultConfig = normalizeDesiredConfig({
    networkingMethod: methodName(config.networkingMethod),
    dhcp,
    ...(config.virtualIpv4 ? { virtualIpv4: config.virtualIpv4 } : {}),
    ...(config.networkLength !== undefined
      ? { networkLength: config.networkLength }
      : {}),
    noTun: Boolean(config.noTun),
    peerUrls,
    publicServerUrl: config.publicServerUrl ?? "",
    listenerUrls: [...(config.listenerUrls ?? [])],
    relayNetworkWhitelist:
      config.enableRelayNetworkWhitelist === false
        ? []
        : [...relayWhitelist],
    routes: config.enableManualRoutes ? [...(config.routes ?? [])] : [],
    acceptRoutes: Boolean(config.enableManualRoutes),
    ...(config.mtu !== undefined ? { mtu: config.mtu } : {}),
    ...(config.disableP2p !== undefined ? { disableP2p: config.disableP2p } : {}),
    ...(config.latencyFirst !== undefined
      ? { latencyFirst: config.latencyFirst }
      : {}),
  });

  // Validate the result with the same schema the API uses, so an import can
  // never create a revision the panel cannot edit later.
  desiredConfigSchema.parse(defaultConfig);

  if ((config.proxyCidrs ?? []).length > 0) {
    unsupported.push("proxy CIDRs (EasyPlane only pushes approved subnet routes)");
  }
  if ((config.exitNodes ?? []).length > 0 || config.enableExitNode) {
    unsupported.push("exit nodes (EasyPlane only pushes an approved exit-node request)");
  }
  if (config.acl && countAclRules(config.acl) > 0) {
    unsupported.push("ACL (use an EasyPlane policy document; nothing is imported)");
  }
  if ((config.managedCredentials ?? []).length > 0) unsupported.push("managed credentials");
  if (config.credentialFile) unsupported.push("credential file");
  if ((config.portForwards ?? []).length > 0) unsupported.push("port forwarding");
  if ((config.mappedListeners ?? []).length > 0) unsupported.push("mapped listeners");
  if (config.vpnPortalConfig) {
    unsupported.push(
      "VPN portal settings (recreate the clients under WireGuard clients in the network)",
    );
  }
  if (config.enableSocks5 || config.socks5Port !== undefined) unsupported.push("SOCKS5 portal");
  if (config.secureMode?.enabled) {
    unsupported.push("secure mode / credential settings");
  }
  if (config.disableIpv6 || config.ipv6PublicAddrProvider || config.ipv6PublicAddrAuto) {
    unsupported.push("IPv6 settings");
  }
  if (config.instanceRecvBpsLimit !== undefined && config.instanceRecvBpsLimit !== 0n) {
    unsupported.push("receive bandwidth limit");
  }
  if (config.socketMark !== undefined) unsupported.push("socket mark");
  if (config.dataCompressAlgo !== undefined && config.dataCompressAlgo !== 1) {
    unsupported.push("data compression algorithm");
  }
  if (config.instanceId) {
    warnings.push(
      "the instance id belongs to a specific device and is not imported (EasyPlane derives one per device)",
    );
  }
  if (config.hostname) {
    warnings.push(
      "the hostname belongs to a specific device and is not imported (EasyPlane uses the device's DNS name)",
    );
  }

  const suggested =
    hints.suggestedName?.trim() ||
    networkName;
  const name = suggested.slice(0, 120);

  const summary: ImportSummary = {
    hostname: config.hostname ?? null,
    networkingMethod: methodName(config.networkingMethod),
    dhcp,
    virtualIpv4: config.virtualIpv4 ?? null,
    networkLength: config.networkLength ?? null,
    peerUrls,
    listenerUrls: [...(config.listenerUrls ?? [])],
    routes: config.enableManualRoutes ? [...(config.routes ?? [])] : [],
    proxyCidrs: [...(config.proxyCidrs ?? [])],
    exitNodes: [...(config.exitNodes ?? [])],
    portForwards: config.portForwards.length,
    aclChains: config.acl ? countAclRules(config.acl) : 0,
    magicDns: Boolean(config.enableMagicDns),
  };

  return {
    spec: {
      name,
      networkName,
      ipv4Cidr,
      magicDnsEnabled: Boolean(config.enableMagicDns),
      defaultConfig,
    },
    summary,
    warnings,
    unsupported: [...new Set(unsupported)],
  };
}

export function countAclRules(acl: unknown): number {
  const chains = (acl as { aclV1?: { chains?: Array<{ rules?: unknown[] }> } } | undefined)
    ?.aclV1?.chains;
  if (!Array.isArray(chains)) return 0;
  return chains.reduce((total, chain) => total + (chain.rules?.length ?? 0), 0);
}
