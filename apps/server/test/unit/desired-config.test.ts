import { describe, expect, it } from "vitest";

import {
  UnknownTokenRateLimiter,
  buildNetworkConfig,
  configMatchesDesired,
  normalizeDesiredConfig,
} from "@easyplane/server";

function desired(overrides: Record<string, unknown> = {}) {
  return buildNetworkConfig({
    networkId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    instanceId: "33333333-3333-4333-8333-333333333333",
    deviceHostname: "node-a",
    networkName: "net",
    networkSecret: "secret",
    assignedIpv4: "10.144.144.2",
    ipv4Cidr: "10.144.144.0/24",
    stored: normalizeDesiredConfig({ hostname: "node-a", ...overrides }),
  });
}

describe("config comparison", () => {
  it("matches the config a normalising client reports back", () => {
    const wanted = desired();
    const remote = {
      ...wanted,
      // EasyTier normalises Standalone to Manual and fills build defaults.
      networkingMethod: 1,
      instanceId: undefined,
    };
    expect(configMatchesDesired(remote, wanted)).toBe(true);
  });

  it("detects a different network name, secret or hostname", () => {
    const wanted = desired();
    expect(configMatchesDesired({ ...wanted, networkName: "other" }, wanted)).toBe(false);
    expect(configMatchesDesired({ ...wanted, networkSecret: "other" }, wanted)).toBe(false);
    expect(configMatchesDesired({ ...wanted, hostname: "other" }, wanted)).toBe(false);
  });

  it("compares the IPv4 address semantically", () => {
    const wanted = desired();
    expect(
      configMatchesDesired({ ...wanted, virtualIpv4: "10.144.144.99" }, wanted),
    ).toBe(false);
    expect(
      configMatchesDesired({ ...wanted, virtualIpv4: "10.144.144.2" }, wanted),
    ).toBe(true);
  });

  it("detects option and peer drift", () => {
    const wanted = desired({ peerUrls: ["tcp://peer:11010"] });
    expect(configMatchesDesired({ ...wanted, noTun: true }, wanted)).toBe(false);
    expect(configMatchesDesired({ ...wanted, peerUrls: [] }, wanted)).toBe(false);
    expect(
      configMatchesDesired({ ...wanted, peerUrls: ["tcp://peer:11010"] }, wanted),
    ).toBe(true);
  });

  it("does not compare fields the client is entitled to rewrite", () => {
    const wanted = desired({ dhcp: false });
    expect(
      configMatchesDesired(
        { ...wanted, listenerUrls: ["ring://x"], bindDevice: true },
        wanted,
      ),
    ).toBe(true);
  });
});

describe("unknown token rate limiter", () => {
  it("allows up to the limit per window and then cuts off", () => {
    const limiter = new UnknownTokenRateLimiter(3);
    const now = 1_000_000;
    expect(limiter.record("1.2.3.4", now)).toBe(true);
    expect(limiter.record("1.2.3.4", now + 1)).toBe(true);
    expect(limiter.record("1.2.3.4", now + 2)).toBe(true);
    expect(limiter.record("1.2.3.4", now + 3)).toBe(false);
    // Another source is unaffected.
    expect(limiter.record("5.6.7.8", now + 4)).toBe(true);
    // The window slides.
    expect(limiter.record("1.2.3.4", now + 61_000)).toBe(true);
  });
});
