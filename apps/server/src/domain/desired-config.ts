import { acl, manage } from "@easyplane/proto";

import { buildMinimalNetworkConfig } from "../config/network-config.js";
import { cidrPrefix, parseIpv4 } from "./ip.js";
import { canonicalAcl } from "./policy/canonical.js";
import { z } from "zod";

/**
 * Editable, non-secret part of a device's desired NetworkConfig. The EasyTier
 * `network_secret` never enters a revision row: it is read from the network
 * row (encrypted at rest) when the config is pushed.
 */
export const desiredConfigSchema = z
  .object({
    /**
     * Deprecated: the device's DNS name is identity, not revision content.
     * Kept so older revisions still parse; ignored when building the config.
     */
    hostname: z.string().min(1).max(253).optional(),
    networkingMethod: z
      .enum(["publicServer", "manual", "standalone"])
      .default("standalone"),
    dhcp: z.boolean().default(false),
    virtualIpv4: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,3}){3}$/, "must be an IPv4 address")
      .optional(),
    networkLength: z.number().int().min(8).max(30).optional(),
    noTun: z.boolean().default(false),
    /**
     * Deprecated: MagicDNS is enabled per network (`networks.magic_dns_enabled`)
     * so one switch keeps names and records consistent.
     */
    enableMagicDns: z.boolean().default(false),
    peerUrls: z.array(z.string().min(1).max(512)).max(64).default([]),
    publicServerUrl: z.string().max(512).default(""),
    listenerUrls: z.array(z.string().min(1).max(512)).max(64).default([]),
    relayNetworkWhitelist: z.array(z.string().min(1).max(128)).max(256).default([]),
    /**
     * Deprecated/derived: proxy CIDRs come from approved subnet-route requests
     * and exit-node mode from an approved exit-node request.
     */
    proxyCidrs: z.array(z.string().min(1).max(64)).max(256).default([]),
    routes: z.array(z.string().min(1).max(64)).max(256).default([]),
    exitNodes: z.array(z.string().min(1).max(128)).max(256).default([]),
    /**
     * Install the network's approved subnet routes towards this device
     * (EasyTier `enable_manual_routes` + `routes`).
     */
    acceptRoutes: z.boolean().default(false),
    mtu: z.number().int().min(576).max(9000).optional(),
    disableP2p: z.boolean().optional(),
    latencyFirst: z.boolean().optional(),
  })
  .strict();

export type DesiredConfig = z.infer<typeof desiredConfigSchema>;

/**
 * Merge arbitrary stored JSON (possibly from an older revision) with
 * fallbacks. Explicit values in `input` always win over the fallbacks.
 */
export function normalizeDesiredConfig(
  input: unknown,
  fallbacks: Partial<DesiredConfig> = {},
): DesiredConfig {
  const merged = {
    ...fallbacks,
    ...(typeof input === "object" && input !== null ? input : {}),
  };
  return desiredConfigSchema.parse(merged);
}

export interface BuildNetworkConfigOptions {
  networkId: string;
  deviceId: string;
  instanceId: string;
  networkName: string;
  networkSecret: string;
  /** Unique DNS name of the device; becomes the EasyTier hostname. */
  hostname: string;
  stored: DesiredConfig;
  assignedIpv4: string | null;
  ipv4Cidr: string;
  /** Network-level MagicDNS switch (authoritative). */
  magicDnsEnabled?: boolean;
  /** Approved subnet CIDRs this device proxies. */
  proxyCidrs?: string[];
  /** Approved exit-node mode. */
  enableExitNode?: boolean;
  /** Routes installed towards the overlay (accept routes). */
  manualRoutes?: string[];
  /** Compiled ACL for this device, if a policy exists. */
  acl?: acl.Acl;
}

/** Turns a stored revision into the protobuf config pushed to the client. */
export function buildNetworkConfig(
  options: BuildNetworkConfigOptions,
): manage.NetworkConfig {
  const base = buildMinimalNetworkConfig({
    instanceId: options.instanceId,
    networkName: options.networkName,
    networkSecret: options.networkSecret,
    hostname: options.hostname,
    networkingMethod: options.stored.networkingMethod,
    dhcp: options.stored.dhcp,
    virtualIpv4: options.assignedIpv4 ?? options.stored.virtualIpv4 ?? "10.144.144.1",
    networkLength:
      options.stored.networkLength ?? cidrPrefix(options.ipv4Cidr),
    publicServerUrl: options.stored.publicServerUrl,
    peerUrls: options.stored.peerUrls,
    listenerUrls: options.stored.listenerUrls,
    noTun: options.stored.noTun,
    enableMagicDns: options.magicDnsEnabled ?? false,
    enableRelayNetworkWhitelist:
      options.stored.relayNetworkWhitelist.length > 0 ? true : undefined,
    relayNetworkWhitelist: options.stored.relayNetworkWhitelist,
    proxyCidrs: options.proxyCidrs ?? [],
    enableExitNode: options.enableExitNode,
    routes: options.manualRoutes ?? [],
    acl: options.acl,
  });

  return {
    ...base,
    exitNodes: [],
    ...(options.stored.mtu !== undefined ? { mtu: options.stored.mtu } : {}),
    ...(options.stored.disableP2p !== undefined
      ? { disableP2p: options.stored.disableP2p }
      : {}),
    ...(options.stored.latencyFirst !== undefined
      ? { latencyFirst: options.stored.latencyFirst }
      : {}),
  };
}

/**
 * Semantic comparison of the config the client reports
 * (GetNetworkInstanceConfig) against what we pushed.
 *
 * EasyTier normalises `networkingMethod` (Standalone comes back as Manual) and
 * fills build defaults, so a byte-for-byte or hash comparison would always
 * report drift. These are the fields that decide whether the instance is the
 * one we want; everything else is either derived or cosmetic.
 */
export function configMatchesDesired(
  remote: manage.NetworkConfig | undefined,
  desired: manage.NetworkConfig,
): boolean {
  if (!remote) return false;
  if (remote.networkName !== desired.networkName) return false;
  if (remote.networkSecret !== desired.networkSecret) return false;
  if (remote.hostname !== desired.hostname) return false;
  if (Boolean(remote.dhcp) !== Boolean(desired.dhcp)) return false;
  if (Boolean(remote.noTun) !== Boolean(desired.noTun)) return false;
  if (Boolean(remote.enableMagicDns) !== Boolean(desired.enableMagicDns)) {
    return false;
  }
  if (Boolean(remote.enableExitNode) !== Boolean(desired.enableExitNode)) {
    return false;
  }
  if (Boolean(remote.enableManualRoutes) !== Boolean(desired.enableManualRoutes)) {
    return false;
  }

  const sameSet = (left: readonly string[], right: readonly string[]) => {
    if (left.length !== right.length) return false;
    const set = new Set(left);
    return right.every((entry) => set.has(entry));
  };
  if (!sameSet(remote.proxyCidrs ?? [], desired.proxyCidrs ?? [])) return false;
  if (!sameSet(remote.routes ?? [], desired.routes ?? [])) return false;

  if (canonicalAcl(remote.acl) !== canonicalAcl(desired.acl)) return false;

  if (!desired.dhcp) {
    const desiredIp = desired.virtualIpv4
      ? parseIpv4(desired.virtualIpv4)
      : null;
    let remoteIp: number | null = null;
    try {
      remoteIp = remote.virtualIpv4 ? parseIpv4(remote.virtualIpv4) : null;
    } catch {
      remoteIp = null;
    }
    if (desiredIp === null || remoteIp === null || desiredIp !== remoteIp) {
      return false;
    }
    if (
      desired.networkLength !== undefined &&
      remote.networkLength !== undefined &&
      remote.networkLength !== desired.networkLength
    ) {
      return false;
    }
  }

  const remotePeers = new Set(remote.peerUrls);
  if (remotePeers.size !== desired.peerUrls.length) return false;
  for (const peer of desired.peerUrls) {
    if (!remotePeers.has(peer)) return false;
  }

  return true;
}
