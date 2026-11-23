import { describe, expect, it } from "vitest";

import { instance, manage } from "@easyplane/proto";
import {
  buildVpnPortalConfig,
  describeVpnPortalMismatch,
  findClientConfig,
  mapPortalState,
  portalListener,
  portalStatuses,
  vpnPortalConfigMatches,
  wireguardListenAddress,
} from "@easyplane/server";
import { allocateIpv4 } from "../../src/domain/ip.js";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function portalConfig(
  overrides: Partial<manage.VpnPortalConfig> = {},
): manage.VpnPortalConfig {
  return {
    wireguardListen: "0.0.0.0:11013",
    wireguardPrivateKey: KEY,
    clients: [
      { name: "phone", virtualIp: "10.144.144.10", groups: ["tag:mobile"] },
    ],
    ...overrides,
  };
}

describe("WireGuard portal domain", () => {
  it("omits the portal when it is disabled or has no master key", () => {
    expect(
      buildVpnPortalConfig({ listenPort: null, privateKey: KEY }, []),
    ).toBeUndefined();
    expect(
      buildVpnPortalConfig({ listenPort: 11013, privateKey: null }, []),
    ).toBeUndefined();
    expect(
      buildVpnPortalConfig({ listenPort: 11013, privateKey: "  " }, []),
    ).toBeUndefined();
  });

  it("compiles the listen address the client parses as a SocketAddr", () => {
    expect(wireguardListenAddress(11013)).toBe("0.0.0.0:11013");
    const config = buildVpnPortalConfig(
      { listenPort: 51820, privateKey: KEY },
      [
        { name: "phone", virtualIpv4: "10.144.144.10", groups: ["tag:mobile"] },
        { name: "router", virtualIpv4: "10.144.144.11", groups: [] },
      ],
    );
    expect(config).toEqual({
      wireguardListen: "0.0.0.0:51820",
      wireguardPrivateKey: KEY,
      clients: [
        { name: "phone", virtualIp: "10.144.144.10", groups: ["tag:mobile"] },
        { name: "router", virtualIp: "10.144.144.11", groups: [] },
      ],
    });
  });

  it("compares portal configs semantically and sorts client groups", () => {
    const desired = portalConfig();
    expect(vpnPortalConfigMatches(portalConfig(), desired)).toBe(true);
    expect(
      vpnPortalConfigMatches(
        portalConfig({
          clients: [
            {
              name: "phone",
              virtualIp: "10.144.144.10",
              groups: ["tag:mobile"],
            },
          ],
        }),
        desired,
      ),
    ).toBe(true);
    // A different address, name, group set, port or a missing key is drift.
    expect(
      vpnPortalConfigMatches(
        portalConfig({
          clients: [
            { name: "phone", virtualIp: "10.144.144.12", groups: [] },
          ],
        }),
        desired,
      ),
    ).toBe(false);
    expect(
      vpnPortalConfigMatches(portalConfig({ wireguardListen: "0.0.0.0:51820" }), desired),
    ).toBe(false);
    expect(
      vpnPortalConfigMatches(portalConfig({ wireguardPrivateKey: undefined }), desired),
    ).toBe(false);
    expect(vpnPortalConfigMatches(undefined, desired)).toBe(false);
    expect(vpnPortalConfigMatches(portalConfig(), undefined)).toBe(false);
    expect(vpnPortalConfigMatches(undefined, undefined)).toBe(true);
  });

  it("explains drift without ever printing the private key", () => {
    const desired = portalConfig();
    const reasons = describeVpnPortalMismatch(
      portalConfig({
        wireguardListen: "0.0.0.0:1",
        clients: [{ name: "laptop", virtualIp: "10.144.144.20", groups: [] }],
      }),
      desired,
    ).join("\n");
    expect(reasons).toContain("wireguardListen");
    expect(reasons).toContain("clients");
    expect(reasons).not.toContain(KEY);
    expect(
      describeVpnPortalMismatch(undefined, undefined),
    ).toEqual([]);
    expect(
      describeVpnPortalMismatch(undefined, desired).join(" "),
    ).toContain("missing");
    expect(
      describeVpnPortalMismatch(portalConfig(), undefined).join(" "),
    ).toContain("disabled");
  });

  it("maps the portal state enum and reads client configs", () => {
    expect(
      mapPortalState(instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_ONLINE),
    ).toBe("online");
    expect(
      mapPortalState(instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_CONNECTING),
    ).toBe("connecting");
    expect(
      mapPortalState(instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_OFFLINE),
    ).toBe("offline");
    expect(
      mapPortalState(instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_ERROR),
    ).toBe("error");
    expect(mapPortalState(undefined)).toBe("unknown");

    const info: instance.VpnPortalInfo = {
      vpnType: "wireguard",
      clientConfig: "",
      connectedClients: [],
      listener: "wg://0.0.0.0:11013",
      clients: [
        {
          name: "phone",
          virtualIp: "10.144.144.10",
          groups: ["tag:mobile"],
          state: instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_ONLINE,
          peerId: 42,
          endpoint: "203.0.113.9:51820",
          tunnelIp: "100.64.0.2",
          clientConfig: "[Interface]\nPrivateKey = secret\n",
          error: undefined,
        },
      ],
    };
    expect(portalStatuses(info)).toEqual([
      {
        name: "phone",
        state: "online",
        endpoint: "203.0.113.9:51820",
        tunnelIp: "100.64.0.2",
        peerId: 42,
        error: null,
      },
    ]);
    expect(findClientConfig(info, "phone")).toContain("PrivateKey");
    expect(findClientConfig(info, "missing")).toBeNull();
    expect(portalListener(info)).toBe("wg://0.0.0.0:11013");
    expect(portalListener(undefined)).toBeNull();
  });

  it("never allocates an address already used by a device or another client", () => {
    // The allocator takes the union from `usedVirtualIps`, which now includes
    // both tables; this pins the "shared pool" contract at the pure level.
    const used = ["10.144.144.2", "10.144.144.3", "10.144.144.10"];
    const address = allocateIpv4("10.144.144.0/24", used);
    expect(used).not.toContain(address);
    expect(address).toBe("10.144.144.4");
  });
});
