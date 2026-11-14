import { manage } from "@easyplane/proto";

import { buildMinimalNetworkConfig } from "../config/network-config.js";
import { cidrPrefix, parseIpv4 } from "./ip.js";
import { z } from "zod";

/**
 * Editable, non-secret part of a device's desired NetworkConfig. The EasyTier
 * `network_secret` never enters a revision row: it is read from the network
 * row (encrypted at rest) when the config is pushed.
 */
export const desiredConfigSchema = z
  .object({
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
    enableMagicDns: z.boolean().default(false),
    peerUrls: z.array(z.string().min(1).max(512)).max(64).default([]),
    publicServerUrl: z.string().max(512).default(""),
    listenerUrls: z.array(z.string().min(1).max(512)).max(64).default([]),
    relayNetworkWhitelist: z.array(z.string().min(1).max(128)).max(256).default([]),
    proxyCidrs: z.array(z.string().min(1).max(64)).max(256).default([]),
    routes: z.array(z.string().min(1).max(64)).max(256).default([]),
    exitNodes: z.array(z.string().min(1).max(128)).max(256).default([]),
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
  deviceHostname: string;
  networkName: string;
  networkSecret: string;
  stored: DesiredConfig;
  assignedIpv4: string | null;
  ipv4Cidr: string;
}

/** Turns a stored revision into the protobuf config pushed to the client. */
export function buildNetworkConfig(
  options: BuildNetworkConfigOptions,
): manage.NetworkConfig {
  const base = buildMinimalNetworkConfig({
    instanceId: options.instanceId,
    networkName: options.networkName,
    networkSecret: options.networkSecret,
    hostname: options.stored.hostname ?? options.deviceHostname,
    networkingMethod: options.stored.networkingMethod,
    dhcp: options.stored.dhcp,
    virtualIpv4: options.assignedIpv4 ?? options.stored.virtualIpv4 ?? "10.144.144.1",
    networkLength:
      options.stored.networkLength ?? cidrPrefix(options.ipv4Cidr),
    publicServerUrl: options.stored.publicServerUrl,
    peerUrls: options.stored.peerUrls,
    listenerUrls: options.stored.listenerUrls,
    noTun: options.stored.noTun,
    enableMagicDns: options.stored.enableMagicDns,
    enableRelayNetworkWhitelist:
      options.stored.relayNetworkWhitelist.length > 0 ? true : undefined,
    relayNetworkWhitelist: options.stored.relayNetworkWhitelist,
  });

  return {
    ...base,
    proxyCidrs: options.stored.proxyCidrs,
    routes: options.stored.routes,
    exitNodes: options.stored.exitNodes,
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
