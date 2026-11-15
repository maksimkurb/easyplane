import { manage } from "@easyplane/proto";

import type { Network } from "../db/schema.js";
import { buildNetworkConfig } from "../domain/desired-config.js";
import { formatIpv4, parseCidr } from "../domain/ip.js";
import { normalizeDesiredConfig } from "../domain/desired-config.js";
import { networkConfigToShareLink } from "./share-link.js";
import { networkConfigToToml } from "./toml.js";

export interface NetworkExport {
  config: manage.NetworkConfig;
  toml: string;
  shareLink: string;
}

/**
 * Builds an exportable EasyTier config for a network: the identity (name +
 * secret), the network defaults and a placeholder address. It is a template a
 * human can hand to a client, not a device config (EasyPlane pushes those).
 */
export function buildNetworkExport(
  network: Network,
  secret: string,
): NetworkExport {
  const { base } = parseCidr(network.ipv4Cidr);
  const placeholderIp = formatIpv4((base + 2) >>> 0);
  const config = buildNetworkConfig({
    networkId: network.id,
    deviceId: "export",
    instanceId: "",
    networkName: network.networkName,
    networkSecret: secret,
    hostname: "",
    stored: normalizeDesiredConfig(network.defaultConfig),
    assignedIpv4: placeholderIp,
    ipv4Cidr: network.ipv4Cidr,
    magicDnsEnabled: network.magicDnsEnabled,
    proxyCidrs: [],
    enableExitNode: false,
    manualRoutes: [],
  });
  config.instanceId = undefined;
  // A template has no device identity; the client fills in its own hostname.
  config.hostname = undefined;
  return {
    config,
    toml: networkConfigToToml(config),
    shareLink: networkConfigToShareLink(config, { displayName: network.name }),
  };
}
