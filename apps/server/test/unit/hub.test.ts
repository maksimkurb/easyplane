import { describe, expect, it } from "vitest";

import {
  buildNetworkConfig,
  configMatchesDesired,
  effectiveHubEndpoints,
  effectiveListenerUrls,
  hubPublicIpsChanged,
  normalizeDesiredConfig,
  normalizePublicIpv4List,
} from "@easyplane/server";

function hub(overrides: Record<string, unknown> = {}) {
  return {
    isHub: true,
    listenPort: null,
    externalPort: null,
    advertisedEndpoints: [] as string[],
    publicIps: [] as string[],
    ...overrides,
  };
}

function desired(listenerUrls: string[], stored: Record<string, unknown> = {}) {
  return buildNetworkConfig({
    networkId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    instanceId: "33333333-3333-4333-8333-333333333333",
    hostname: "hub",
    networkName: "net",
    networkSecret: "secret",
    assignedIpv4: "10.144.144.2",
    ipv4Cidr: "10.144.144.0/24",
    stored: normalizeDesiredConfig(stored),
    listenerUrls,
  });
}

describe("effective hub listeners", () => {
  it("binds tcp and udp on the default port for a hub with no stored listeners", () => {
    expect(effectiveListenerUrls([], hub())).toEqual([
      "tcp://0.0.0.0:11010",
      "udp://0.0.0.0:11010",
    ]);
  });

  it("uses the custom listen port and keeps stored listeners", () => {
    expect(
      effectiveListenerUrls(["ring://abc"], hub({ listenPort: 12000 })),
    ).toEqual([
      "ring://abc",
      "tcp://0.0.0.0:12000",
      "udp://0.0.0.0:12000",
    ]);
  });

  it("does not add listeners for a non-hub", () => {
    expect(
      effectiveListenerUrls(["tcp://0.0.0.0:12000"], {
        isHub: false,
        listenPort: 12000,
      }),
    ).toEqual(["tcp://0.0.0.0:12000"]);
    expect(effectiveListenerUrls([], hub({ isHub: false }))).toEqual([]);
  });
});

describe("effective hub advertised endpoints", () => {
  it("builds the automatic endpoint from the public IP and external port", () => {
    expect(
      effectiveHubEndpoints(
        hub({ externalPort: 13000, listenPort: 12000 }),
        ["203.0.113.5"],
      ),
    ).toEqual(["tcp://203.0.113.5:13000"]);
  });

  it("falls back to the listen port, then to 11010", () => {
    expect(effectiveHubEndpoints(hub({ listenPort: 12000 }), ["203.0.113.5"]))
      .toEqual(["tcp://203.0.113.5:12000"]);
    expect(effectiveHubEndpoints(hub(), ["203.0.113.5"])).toEqual([
      "tcp://203.0.113.5:11010",
    ]);
  });

  it("skips private, loopback, CGNAT and link-local addresses", () => {
    const publicIps = [
      "10.0.0.10",
      "172.16.4.2",
      "172.31.255.1",
      "192.168.1.2",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "203.0.113.5",
    ];
    expect(normalizePublicIpv4List(publicIps)).toEqual(["203.0.113.5"]);
    expect(effectiveHubEndpoints(hub(), publicIps)).toEqual([
      "tcp://203.0.113.5:11010",
    ]);
  });

  it("de-duplicates the automatic endpoint against an extra address", () => {
    expect(
      effectiveHubEndpoints(
        hub({
          advertisedEndpoints: [
            "tcp://203.0.113.5:11010",
            "wss://hub.example.com:443",
          ],
        }),
        ["203.0.113.5"],
      ),
    ).toEqual(["tcp://203.0.113.5:11010", "wss://hub.example.com:443"]);
  });

  it("keeps extra addresses when the public IP is unknown", () => {
    expect(
      effectiveHubEndpoints(
        hub({
          advertisedEndpoints: [
            "tcp://hub.example.com:11010",
            "udp://203.0.113.9:11010",
          ],
        }),
        [],
      ),
    ).toEqual([
      "tcp://hub.example.com:11010",
      "udp://203.0.113.9:11010",
    ]);
  });

  it("drops invalid stored extras instead of breaking every push", () => {
    expect(
      effectiveHubEndpoints(
        hub({ advertisedEndpoints: ["ftp://nope.example", "wss://hub.example"] }),
        [],
      ),
    ).toEqual(["wss://hub.example"]);
  });

  it("reports a repush only when the automatic set actually changes", () => {
    const device = hub();
    expect(hubPublicIpsChanged(device, [], ["203.0.113.5"])).toBe(true);
    expect(hubPublicIpsChanged(device, ["203.0.113.5"], ["198.51.100.7"])).toBe(
      true,
    );
    expect(
      hubPublicIpsChanged(device, ["203.0.113.5", "198.51.100.7"], [
        "198.51.100.7",
        "203.0.113.5",
      ]),
    ).toBe(false);
    expect(hubPublicIpsChanged(device, [], [])).toBe(false);
    expect(
      hubPublicIpsChanged(device, [], ["10.0.0.4", "192.168.1.4"]),
    ).toBe(false);
    expect(
      hubPublicIpsChanged(hub({ isHub: false }), [], ["203.0.113.5"]),
    ).toBe(false);
  });
});

describe("hub listeners in the compiled config", () => {
  it("adds the effective listeners to a hub config", () => {
    const config = desired(effectiveListenerUrls([], hub()));
    expect(config.listenerUrls).toEqual([
      "tcp://0.0.0.0:11010",
      "udp://0.0.0.0:11010",
    ]);
  });

  it("treats a missing hub listener as drift", () => {
    const wanted = desired([
      "tcp://0.0.0.0:11010",
      "udp://0.0.0.0:11010",
    ]);
    expect(configMatchesDesired({ ...wanted, listenerUrls: [] }, wanted)).toBe(
      false,
    );
    expect(
      configMatchesDesired(
        {
          ...wanted,
          listenerUrls: [
            "ring://instance",
            "tcp://0.0.0.0:11010/",
            "udp://0.0.0.0:11010",
          ],
        },
        wanted,
      ),
    ).toBe(true);
  });
});
