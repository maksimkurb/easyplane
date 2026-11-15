import { describe, expect, it } from "vitest";

import {
  buildNetworkConfig,
  compilePeerList,
  compilePeerUrls,
  configMatchesDesired,
  isValidPeerUrl,
  normalizeDesiredConfig,
  peerUrlKey,
  validatePeerUrl,
  type PeerCompilerEntry,
} from "@easyplane/server";

const TARGET = "11111111-1111-4111-8111-111111111111";
const TARGET_MACHINE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HUB = "22222222-2222-4222-8222-222222222222";
const HUB_MACHINE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function hubDevice(overrides: Partial<{
  id: string;
  machineId: string;
  state: "pending" | "approved" | "blocked";
  isHub: boolean;
  advertisedEndpoints: string[];
}> = {}) {
  return {
    id: HUB,
    machineId: HUB_MACHINE,
    state: "approved" as const,
    isHub: true,
    advertisedEndpoints: ["tcp://hub.example.com:11010"],
    ...overrides,
  };
}

function deviceEntry(overrides: Parameters<typeof hubDevice>[0] = {}): PeerCompilerEntry {
  return { deviceId: HUB, url: null, device: hubDevice(overrides) };
}

describe("peer URL validation", () => {
  it("accepts the schemes the pinned easytier-core parses", () => {
    const urls = [
      "tcp://hub.example.com:11010",
      "udp://10.0.0.1:11010",
      "ws://hub.example.com:11011/path",
      "wss://hub.example.com:11012",
      "quic://hub.example.com:11013",
      "wg://hub.example.com:11014",
      "ring://0b5f0b6a-1111-4111-8111-111111111111",
      "unix:///run/easytier.sock",
      "faketcp://hub.example.com:11015",
    ];
    for (const url of urls) expect(isValidPeerUrl(url), url).toBe(true);
  });

  it("rejects unsupported schemes, credentials and junk", () => {
    for (const url of [
      "ftp://hub.example.com:11010",
      "tcp://user:pass@hub.example.com:11010",
      "not a url",
      "tcp://",
      "",
    ]) {
      expect(isValidPeerUrl(url), url).toBe(false);
    }
  });

  it("trims the URL and keeps it verbatim otherwise", () => {
    expect(validatePeerUrl("  tcp://hub:11010/ ")).toBe("tcp://hub:11010/");
    expect(peerUrlKey("tcp://hub:11010///")).toBe("tcp://hub:11010");
  });
});

describe("peer list compilation", () => {
  it("excludes the target device by id (a hub does not dial itself)", () => {
    expect(
      compilePeerUrls({
        targetDeviceId: HUB,
        targetMachineId: HUB_MACHINE,
        entries: [deviceEntry()],
      }),
    ).toEqual([]);
  });

  it("excludes the target by machine id when the row id differs", () => {
    expect(
      compilePeerUrls({
        targetDeviceId: TARGET,
        targetMachineId: HUB_MACHINE,
        entries: [deviceEntry()],
      }),
    ).toEqual([]);
  });

  it("puts approved hub endpoints in stable entry/endpoint order", () => {
    const urls = compilePeerUrls({
      targetDeviceId: TARGET,
      targetMachineId: TARGET_MACHINE,
      entries: [
        { deviceId: null, url: "udp://external.example:11010" },
        deviceEntry({
          advertisedEndpoints: [
            "tcp://hub-b.example:11010",
            "wss://hub-a.example:443",
          ],
        }),
        { deviceId: null, url: "tcp://external.example:11010" },
      ],
    });
    expect(urls).toEqual([
      "udp://external.example:11010",
      "tcp://hub-b.example:11010",
      "wss://hub-a.example:443",
      "tcp://external.example:11010",
    ]);
  });

  it("de-duplicates across entries and endpoints, ignoring trailing slashes", () => {
    const urls = compilePeerUrls({
      targetDeviceId: TARGET,
      targetMachineId: TARGET_MACHINE,
      entries: [
        deviceEntry(),
        { deviceId: null, url: "tcp://hub.example.com:11010/" },
        deviceEntry({ advertisedEndpoints: ["tcp://hub.example.com:11010"] }),
      ],
    });
    expect(urls).toEqual(["tcp://hub.example.com:11010"]);
  });

  it("skips pending and blocked hubs", () => {
    for (const state of ["pending", "blocked"] as const) {
      expect(
        compilePeerUrls({
          targetDeviceId: TARGET,
          targetMachineId: TARGET_MACHINE,
          entries: [deviceEntry({ state })],
        }),
      ).toEqual([]);
    }
  });

  it("skips devices that are not hubs", () => {
    expect(
      compilePeerUrls({
        targetDeviceId: TARGET,
        targetMachineId: TARGET_MACHINE,
        entries: [deviceEntry({ isHub: false })],
      }),
    ).toEqual([]);
  });

  it("pushes a raw URL unchanged, including to the device it points at", () => {
    expect(
      compilePeerUrls({
        targetDeviceId: TARGET,
        targetMachineId: TARGET_MACHINE,
        entries: [{ deviceId: null, url: "tcp://raw.example.com:11010/" }],
      }),
    ).toEqual(["tcp://raw.example.com:11010/"]);
  });

  it("skips a raw URL linked to the target device", () => {
    expect(
      compilePeerUrls({
        targetDeviceId: TARGET,
        targetMachineId: TARGET_MACHINE,
        entries: [
          {
            deviceId: TARGET,
            url: "tcp://self.example.com:11010",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("drops URLs the core could not parse", () => {
    expect(
      compilePeerUrls({
        targetDeviceId: TARGET,
        targetMachineId: TARGET_MACHINE,
        entries: [
          { deviceId: null, url: "ftp://invalid.example:11010" },
          { deviceId: null, url: "tcp://valid.example:11010" },
        ],
      }),
    ).toEqual(["tcp://valid.example:11010"]);
  });

  it("gives the only hub an empty list (it is the listener)", () => {
    const network = [
      deviceEntry({
        advertisedEndpoints: [
          "tcp://only-hub.example:11010",
          "wss://only-hub.example:443",
        ],
      }),
    ];
    expect(
      compilePeerUrls({
        targetDeviceId: HUB,
        targetMachineId: HUB_MACHINE,
        entries: network,
      }),
    ).toEqual([]);
    expect(
      compilePeerUrls({
        targetDeviceId: TARGET,
        targetMachineId: TARGET_MACHINE,
        entries: network,
      }),
    ).toEqual([
      "tcp://only-hub.example:11010",
      "wss://only-hub.example:443",
    ]);
  });
});

describe("rendezvous endpoints in the compiled peer list", () => {
  const NODE = ["tcp://rv.example.com:11010", "udp://rv.example.com:11010"];

  it("appends rendezvous endpoints after network entries with their source", () => {
    const peers = compilePeerList({
      targetDeviceId: TARGET,
      targetMachineId: TARGET_MACHINE,
      entries: [{ deviceId: null, url: "tcp://hub.example.com:11010" }],
      rendezvousEndpoints: NODE,
    });
    expect(peers).toEqual([
      { url: "tcp://hub.example.com:11010", source: "external" },
      { url: "tcp://rv.example.com:11010", source: "rendezvous" },
      { url: "udp://rv.example.com:11010", source: "rendezvous" },
    ]);
  });

  it("never self-excludes the rendezvous node, even for the hub device", () => {
    const peers = compilePeerList({
      targetDeviceId: HUB,
      targetMachineId: HUB_MACHINE,
      entries: [deviceEntry()],
      rendezvousEndpoints: NODE,
    });
    expect(peers.map((peer) => peer.url)).toEqual(NODE);
  });

  it("de-duplicates a rendezvous endpoint that is also a hub endpoint", () => {
    const peers = compilePeerList({
      targetDeviceId: TARGET,
      targetMachineId: TARGET_MACHINE,
      entries: [
        deviceEntry({ advertisedEndpoints: ["tcp://rv.example.com:11010/"] }),
      ],
      rendezvousEndpoints: ["tcp://rv.example.com:11010"],
    });
    expect(peers).toEqual([
      { url: "tcp://rv.example.com:11010/", source: "hub" },
    ]);
  });

  it("drops invalid rendezvous endpoints instead of failing the push", () => {
    expect(
      compilePeerList({
        targetDeviceId: TARGET,
        targetMachineId: TARGET_MACHINE,
        entries: [],
        rendezvousEndpoints: ["ftp://bad.example:11010", "tcp://ok.example:11010"],
      }),
    ).toEqual([{ url: "tcp://ok.example:11010", source: "rendezvous" }]);
  });
});

describe("desired config peer resolution", () => {
  function config(peerUrls: string[] | undefined) {
    return buildNetworkConfig({
      networkId: TARGET,
      deviceId: TARGET,
      instanceId: "33333333-3333-4333-8333-333333333333",
      hostname: "node-a",
      networkName: "net",
      networkSecret: "secret",
      assignedIpv4: "10.144.144.2",
      ipv4Cidr: "10.144.144.0/24",
      stored: normalizeDesiredConfig({
        peerUrls: ["tcp://legacy.example:11010"],
      }),
      peerUrls,
    });
  }

  it("replaces the stored legacy peer URLs with the compiled list", () => {
    expect(config([]).peerUrls).toEqual([]);
    expect(config(["tcp://hub.example:11010"]).peerUrls).toEqual([
      "tcp://hub.example:11010",
    ]);
  });

  it("falls back to the stored list when no compiled list is supplied", () => {
    expect(config(undefined).peerUrls).toEqual(["tcp://legacy.example:11010"]);
  });

  it("only asks for Manual networking when the effective list is non-empty", () => {
    // Standalone = 2, Manual = 1 in the generated enum.
    expect(config([]).networkingMethod).toBe(2);
    expect(config(["tcp://hub.example:11010"]).networkingMethod).toBe(1);
  });

  it("pushes p2p_only and secure mode only when the network enables them", () => {
    const base = {
      networkId: TARGET,
      deviceId: TARGET,
      instanceId: "33333333-3333-4333-8333-333333333333",
      hostname: "node-a",
      networkName: "net",
      networkSecret: "secret",
      assignedIpv4: "10.144.144.2",
      ipv4Cidr: "10.144.144.0/24",
      stored: normalizeDesiredConfig({}),
    };
    const plain = buildNetworkConfig(base);
    expect(plain.p2pOnly).toBeUndefined();
    expect(plain.secureMode).toBeUndefined();

    const advanced = buildNetworkConfig({
      ...base,
      p2pOnly: true,
      secureMode: true,
    });
    expect(advanced.p2pOnly).toBe(true);
    expect(advanced.secureMode?.enabled).toBe(true);
    expect(configMatchesDesired(advanced, advanced)).toBe(true);

    const withoutSecure = { ...advanced, secureMode: undefined };
    expect(configMatchesDesired(withoutSecure, advanced)).toBe(false);
    const withoutP2p = { ...advanced, p2pOnly: undefined };
    expect(configMatchesDesired(withoutP2p, advanced)).toBe(false);
  });
});
