import { describe, expect, it } from "vitest";

import { instance, manage } from "@easyplane/proto";
import {
  buildVpnPortalConfig,
  describeVpnPortalMismatch,
  formatPortalVirtualIp,
  isPortalApplyError,
  readPortalApplyError,
  withPortalApplyError,
  withoutPortalApplyError,
  findClientConfig,
  mapPortalState,
  portalListener,
  portalStatuses,
  portalVirtualIpProblem,
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
    const settings = { privateKey: KEY, networkPrefixLength: 24 };
    expect(
      buildVpnPortalConfig({ ...settings, listenPort: null }, []),
    ).toBeUndefined();
    expect(
      buildVpnPortalConfig({ ...settings, listenPort: 11013, privateKey: null }, []),
    ).toBeUndefined();
    expect(
      buildVpnPortalConfig({ ...settings, listenPort: 11013, privateKey: "  " }, []),
    ).toBeUndefined();
  });

  it("compiles the listen address the client parses as a SocketAddr", () => {
    expect(wireguardListenAddress(11013)).toBe("0.0.0.0:11013");
    const config = buildVpnPortalConfig(
      { listenPort: 51820, privateKey: KEY, networkPrefixLength: 24 },
      [
        { name: "phone", virtualIpv4: "10.144.144.10", groups: ["tag:mobile"] },
        { name: "router", virtualIpv4: "10.144.144.11", groups: [] },
      ],
    );
    // EasyTier >= 2.7.0 parses virtual_ip as Ipv4Inet; a bare address is a /32
    // and the portal refuses to start ("unusable virtual IP").
    expect(config).toEqual({
      wireguardListen: "0.0.0.0:51820",
      wireguardPrivateKey: KEY,
      clients: [
        { name: "phone", virtualIp: "10.144.144.10/24", groups: ["tag:mobile"] },
        { name: "router", virtualIp: "10.144.144.11/24", groups: [] },
      ],
    });
  });

  it("pins the prod h-1 keen-h2 case: virtual_ip carries the network prefix", () => {
    // Observed on 2.7.1: a bare 10.144.144.8 is parsed as /32, whose first and
    // last address are the client itself, so the instance fails with
    // "VPN portal client keen-h2 has an unusable virtual IP 10.144.144.8".
    expect(formatPortalVirtualIp("10.144.144.8", 24)).toBe("10.144.144.8/24");
    const config = buildVpnPortalConfig(
      { listenPort: 11013, privateKey: KEY, networkPrefixLength: 24 },
      [{ name: "keen-h2", virtualIpv4: "10.144.144.8", groups: [] }],
    );
    expect(config?.clients).toEqual([
      { name: "keen-h2", virtualIp: "10.144.144.8/24", groups: [] },
    ]);
    // The prefix comes from the virtual network, not from the host address.
    const wide = buildVpnPortalConfig(
      { listenPort: 11013, privateKey: KEY, networkPrefixLength: 16 },
      [{ name: "keen-h2", virtualIpv4: "10.144.144.8", groups: [] }],
    );
    expect(wide?.clients[0]?.virtualIp).toBe("10.144.144.8/16");
  });

  it("rejects the addresses EasyTier refuses for a portal client", () => {
    expect(
      portalVirtualIpProblem({
        virtualIpv4: "10.144.144.8",
        prefixLength: 24,
        hubVirtualIpv4: "10.144.144.2",
      }),
    ).toBeNull();
    expect(
      portalVirtualIpProblem({
        virtualIpv4: "10.144.144.0",
        prefixLength: 24,
        hubVirtualIpv4: "10.144.144.2",
      }),
    ).toContain("network");
    expect(
      portalVirtualIpProblem({
        virtualIpv4: "10.144.144.255",
        prefixLength: 24,
        hubVirtualIpv4: "10.144.144.2",
      }),
    ).toContain("broadcast");
    expect(
      portalVirtualIpProblem({
        virtualIpv4: "10.144.144.2",
        prefixLength: 24,
        hubVirtualIpv4: "10.144.144.2",
      }),
    ).toContain("hub");
    // A /32 (the bare-address mistake) is always unusable: the client is its
    // own first and last address.
    expect(
      portalVirtualIpProblem({
        virtualIpv4: "10.144.144.8",
        prefixLength: 32,
        hubVirtualIpv4: null,
      }),
    ).not.toBeNull();
  });

  it("recognises the device's portal apply error without matching unrelated failures", () => {
    expect(
      isPortalApplyError(
        "failed to create instance: VPN portal client keen-h2 has an unusable virtual IP 10.144.144.8",
      ),
    ).toBe(true);
    expect(isPortalApplyError("WireGuard portal requires a dedicated private key")).toBe(true);
    expect(isPortalApplyError("vpn_portal_config: bad listen")).toBe(true);
    expect(isPortalApplyError("rpc timeout after 5000ms")).toBe(false);
    expect(isPortalApplyError("instance did not report running")).toBe(false);
  });

  it("persists, reads and clears the rejection marker", () => {
    const marker = {
      message: "failed to create instance: VPN portal client keen-h2 has an unusable virtual IP",
      fingerprint: "abc",
      at: "2026-01-01T00:00:00.000Z",
    };
    const state = withPortalApplyError({ managedConfigPermission: 0 }, marker);
    expect(state.managedConfigPermission).toBe(0);
    expect(readPortalApplyError(state)).toEqual(marker);
    expect(readPortalApplyError({})).toBeNull();
    expect(readPortalApplyError({ wgPortalApplyError: { message: "x" } })).toBeNull();
    expect(withoutPortalApplyError(state)).toEqual({
      managedConfigPermission: 0,
      wgPortal: {
        state: "error",
        error: marker.message,
        vpnType: null,
        connectedClients: 0,
        perClientClients: false,
        checkedAt: marker.at,
      },
    });
    expect(readPortalApplyError(withoutPortalApplyError(state))).toBeNull();
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
    // A bare-address echo (older/pinned build) is the same client; a real
    // prefix change is drift because it changes the generated client config.
    expect(
      vpnPortalConfigMatches(
        portalConfig({
          clients: [{ name: "phone", virtualIp: "10.144.144.10", groups: ["tag:mobile"] }],
        }),
        portalConfig({
          clients: [
            { name: "phone", virtualIp: "10.144.144.10/24", groups: ["tag:mobile"] },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      vpnPortalConfigMatches(
        portalConfig({
          clients: [
            { name: "phone", virtualIp: "10.144.144.10/16", groups: ["tag:mobile"] },
          ],
        }),
        portalConfig({
          clients: [
            { name: "phone", virtualIp: "10.144.144.10/24", groups: ["tag:mobile"] },
          ],
        }),
      ),
    ).toBe(false);
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
