import { describe, expect, it } from "vitest";

import {
  buildNetworkConfig,
  configMatchesDesired,
  describeConfigMismatch,
  normalizeDesiredConfig,
} from "@easyplane/server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const PORTAL = {
  wireguardListen: "0.0.0.0:11013",
  wireguardPrivateKey: KEY,
  clients: [
    { name: "phone", virtualIp: "10.144.144.10", groups: ["tag:mobile"] },
  ],
};

function desired(withPortal: boolean) {
  return buildNetworkConfig({
    networkId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    instanceId: "33333333-3333-4333-8333-333333333333",
    hostname: "hub",
    networkName: "net",
    networkSecret: "secret",
    assignedIpv4: "10.144.144.2",
    ipv4Cidr: "10.144.144.0/24",
    stored: normalizeDesiredConfig({}),
    ...(withPortal ? { vpnPortalConfig: PORTAL } : {}),
  });
}

describe("WireGuard portal in the desired config", () => {
  it("carries vpn_portal_config when the hub enables the portal", () => {
    const config = desired(true);
    expect(config.vpnPortalConfig).toEqual(PORTAL);
    expect(desired(false).vpnPortalConfig).toBeUndefined();
  });

  it("detects enabling, disabling and client-list drift", () => {
    expect(configMatchesDesired(desired(true), desired(true))).toBe(true);
    expect(configMatchesDesired(desired(false), desired(true))).toBe(false);
    expect(configMatchesDesired(desired(true), desired(false))).toBe(false);
    expect(
      configMatchesDesired(
        {
          ...desired(true),
          vpnPortalConfig: {
            ...PORTAL,
            clients: [
              ...PORTAL.clients,
              { name: "tablet", virtualIp: "10.144.144.11", groups: [] },
            ],
          },
        },
        desired(true),
      ),
    ).toBe(false);
  });

  it("explains portal drift without leaking the master key", () => {
    const reasons = describeConfigMismatch(desired(false), desired(true)).join("\n");
    expect(reasons).toContain("vpnPortalConfig");
    expect(reasons).not.toContain(KEY);

    const changed = describeConfigMismatch(
      {
        ...desired(true),
        vpnPortalConfig: { ...PORTAL, wireguardListen: "0.0.0.0:1" },
      },
      desired(true),
    ).join("\n");
    expect(changed).toContain("wireguardListen");
    expect(changed).not.toContain(KEY);
  });
});
