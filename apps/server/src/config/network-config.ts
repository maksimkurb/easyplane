import { manage } from "@easyplane/proto";

/**
 * Builds the NetworkConfig that M0 pushes over RunNetworkInstance.
 *
 * `gen_config` in easytier-core/src/config/api_input.rs only requires a network
 * identity (name + secret) plus an addressing method; the rest are defaults.
 * For the conformance spike we use a standalone network with a fixed virtual IP,
 * so the instance comes up without needing a second peer.
 */
export interface MinimalNetworkConfigOptions {
  instanceId: string;
  networkName: string;
  networkSecret: string;
  hostname: string;
  virtualIpv4?: string;
  networkLength?: number;
  dhcp?: boolean;
  networkingMethod?: "publicServer" | "manual" | "standalone";
  peerUrls?: string[];
  publicServerUrl?: string;
  listenerUrls?: string[];
  noTun?: boolean;
  enableMagicDns?: boolean;
  enableRelayNetworkWhitelist?: boolean;
  relayNetworkWhitelist?: string[];
}

const NETWORKING_METHOD = {
  publicServer: manage.NetworkingMethod.PublicServer,
  manual: manage.NetworkingMethod.Manual,
  standalone: manage.NetworkingMethod.Standalone,
} as const;

export function buildMinimalNetworkConfig(options: MinimalNetworkConfigOptions): manage.NetworkConfig {
  const dhcp = options.dhcp ?? false;
  return {
    instanceId: options.instanceId,
    hostname: options.hostname,
    networkName: options.networkName,
    networkSecret: options.networkSecret,
    networkingMethod: NETWORKING_METHOD[options.networkingMethod ?? "standalone"],
    dhcp,
    ...(dhcp
      ? {}
      : {
          virtualIpv4: options.virtualIpv4 ?? "10.144.144.1",
          networkLength: options.networkLength ?? 24,
        }),
    peerUrls: options.peerUrls ?? [],
    publicServerUrl: options.publicServerUrl ?? "",
    listenerUrls: options.listenerUrls ?? [],
    noTun: options.noTun ?? false,
    enableMagicDns: options.enableMagicDns ?? false,
    enableRelayNetworkWhitelist: options.enableRelayNetworkWhitelist,
    relayNetworkWhitelist: options.relayNetworkWhitelist ?? [],
    // Repeated fields are non-optional in the generated types; left empty so
    // the config stays minimal (see easytier-core/src/config/api_input.rs).
    proxyCidrs: [],
    routes: [],
    exitNodes: [],
    mappedListeners: [],
    portForwards: [],
    managedCredentials: [],
    peers: [],
  };
}
