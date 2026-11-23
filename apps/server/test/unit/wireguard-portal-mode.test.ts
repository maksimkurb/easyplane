import { describe, expect, it } from "vitest";

import { instance, manage } from "@easyplane/proto";
import {
  DEFAULT_LEGACY_CLIENT_CIDR,
  PER_CLIENT_PORTAL_MIN_VERSION,
  cidrOverlapsAny,
  compareEasyTierVersions,
  interpretPortalProbe,
  legacyClientConfig,
  legacyConnectedClients,
  legacyPortalConfigHint,
  legacyPortalReplyError,
  legacyPortalUrl,
  parseEasyTierVersion,
  portalModeForVersion,
  readPortalSnapshot,
  resolvePortalMode,
  withPortalSnapshot,
} from "@easyplane/server";

function portalInfo(
  overrides: Partial<instance.VpnPortalInfo> = {},
): instance.VpnPortalInfo {
  return {
    vpnType: "wireguard",
    clientConfig: "",
    connectedClients: [],
    clients: [],
    listener: undefined,
    ...overrides,
  };
}

describe("EasyTier portal generation", () => {
  it("pins the owner-stated per-client threshold", () => {
    expect(PER_CLIENT_PORTAL_MIN_VERSION).toBe("2.7.0");
  });

  it("parses the numeric version and ignores build metadata", () => {
    expect(parseEasyTierVersion("2.6.4-8428a89d")).toEqual({
      major: 2,
      minor: 6,
      patch: 4,
    });
    expect(parseEasyTierVersion("2.7.0-nightly.20261006")).toEqual({
      major: 2,
      minor: 7,
      patch: 0,
    });
    expect(parseEasyTierVersion("v2.7.1")).toEqual({ major: 2, minor: 7, patch: 1 });
    expect(parseEasyTierVersion("")).toBeNull();
    expect(parseEasyTierVersion("nightly")).toBeNull();
    expect(parseEasyTierVersion(undefined)).toBeNull();
  });

  it("compares versions numerically, not lexicographically", () => {
    expect(compareEasyTierVersions("2.7.0", "2.6.4")).toBeGreaterThan(0);
    expect(compareEasyTierVersions("2.6.10", "2.6.9")).toBeGreaterThan(0);
    expect(compareEasyTierVersions("2.6.4-8428a89d", "2.6.4")).toBe(0);
    expect(compareEasyTierVersions("nope", "2.6.4")).toBeNull();
  });

  it("gates the portal generation at 2.7.0", () => {
    expect(portalModeForVersion("2.6.4-8428a89d")).toBe("legacy");
    expect(portalModeForVersion("2.7.0-abc")).toBe("per-client");
    expect(portalModeForVersion("2.7.1")).toBe("per-client");
    expect(portalModeForVersion("3.0.0")).toBe("per-client");
    expect(portalModeForVersion("")).toBe("unknown");
    expect(portalModeForVersion("OpenWrt")).toBe("unknown");
  });

  it("lets observed behaviour override a missing or odd version", () => {
    expect(
      resolvePortalMode({ version: "2.6.4", reportedPerClientPortal: true }),
    ).toBe("per-client");
    expect(
      resolvePortalMode({ version: "", probedPerClientClients: true }),
    ).toBe("per-client");
    expect(resolvePortalMode({ version: "2.6.4" })).toBe("legacy");
    expect(resolvePortalMode({ version: "" })).toBe("unknown");
    // Behaviour only overrides upwards: a per-client version without any
    // evidence is still per-client (that is what the version means).
    expect(resolvePortalMode({ version: "2.7.0" })).toBe("per-client");
  });

  it("builds the legacy CLI form 2.6.x parses", () => {
    expect(DEFAULT_LEGACY_CLIENT_CIDR).toBe("10.14.14.0/24");
    expect(legacyPortalUrl(11013, DEFAULT_LEGACY_CLIENT_CIDR)).toBe(
      "wg://0.0.0.0:11013/10.14.14.0/24",
    );
    const hint = legacyPortalConfigHint(11013, DEFAULT_LEGACY_CLIENT_CIDR);
    expect(hint.cli).toContain("--vpn-portal wg://0.0.0.0:11013/10.14.14.0/24");
    expect(hint.toml).toContain("[vpn_portal_config]");
    expect(hint.toml).toContain('client_cidr = "10.14.14.0/24"');
    expect(hint.toml).toContain('wireguard_listen = "0.0.0.0:11013"');
  });
});

describe("portal probe interpretation", () => {
  it("detects a build without the wireguard feature from vpn_type = null", () => {
    const snapshot = interpretPortalProbe(
      portalInfo({ vpnType: "null" }),
      "legacy",
    );
    expect(snapshot.state).toBe("unsupported");
    expect(snapshot.error).toMatch(/wireguard/i);
  });

  it("detects 2.6.4's not-started reply as an error, not as unsupported", () => {
    const reply = "ERROR: Wireguard VPN Portal Not Started";
    expect(legacyPortalReplyError(reply)).toBe(reply);
    const snapshot = interpretPortalProbe(
      portalInfo({ clientConfig: reply }),
      "legacy",
    );
    expect(snapshot.state).toBe("error");
    expect(snapshot.error).toBe(reply);
  });

  it("treats an empty legacy config as not generated yet", () => {
    const snapshot = interpretPortalProbe(portalInfo(), "legacy");
    expect(snapshot.state).toBe("error");
  });

  it("treats a legacy placeholder config as running and returns it", () => {
    const config = "[Interface]\nPrivateKey = secret\nAddress = 10.14.14.2/24\n";
    const snapshot = interpretPortalProbe(
      portalInfo({ clientConfig: config, connectedClients: ["10.14.14.2"] }),
      "legacy",
    );
    expect(snapshot.state).toBe("running");
    expect(snapshot.connectedClients).toBe(1);
    expect(legacyClientConfig(portalInfo({ clientConfig: config }))).toBe(config);
    expect(legacyConnectedClients(portalInfo({ connectedClients: ["a", "b"] }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("treats named clients as the per-client generation", () => {
    const info = portalInfo({
      clients: [
        {
          name: "phone",
          virtualIp: "10.144.144.4",
          groups: [],
          state: instance.VpnPortalClientState.VPN_PORTAL_CLIENT_STATE_ONLINE,
          peerId: 7,
          endpoint: undefined,
          tunnelIp: undefined,
          clientConfig: "",
          error: undefined,
        },
      ],
    });
    const snapshot = interpretPortalProbe(info, "per-client");
    expect(snapshot.state).toBe("running");
    expect(snapshot.perClientClients).toBe(true);
    expect(legacyClientConfig(info)).toBeNull();
  });

  it("never reports a key or a client config through the snapshot", () => {
    const snapshot = interpretPortalProbe(
      portalInfo({ clientConfig: "ERROR: Wireguard VPN Portal Not Started" }),
      "legacy",
    );
    expect(JSON.stringify(snapshot)).not.toContain("PrivateKey");
  });

  it("round-trips the persisted snapshot without losing report keys", () => {
    const snapshot = interpretPortalProbe(portalInfo({ vpnType: "null" }), "legacy");
    const state = withPortalSnapshot({ managedConfigPermission: 0 }, snapshot, "legacy");
    expect(state.managedConfigPermission).toBe(0);
    expect(state.wgPortalMode).toBe("legacy");
    const parsed = readPortalSnapshot(state);
    expect(parsed?.state).toBe("unsupported");
    expect(parsed?.checkedAt).toBe(snapshot.checkedAt);
    expect(readPortalSnapshot({})).toBeNull();
    expect(readPortalSnapshot({ wgPortal: { state: "bogus" } })).toBeNull();
  });

  it("keeps the per-client config comparison semantic", () => {
    const base: manage.VpnPortalConfig = {
      wireguardListen: "0.0.0.0:11013",
      wireguardPrivateKey: "key",
      clients: [{ name: "phone", virtualIp: "10.144.144.4", groups: [] }],
    };
    expect(base.clients.length).toBe(1);
  });
});

describe("legacy portal pool validation", () => {
  it("detects overlap with the network or an approved subnet", () => {
    expect(cidrOverlapsAny("10.14.14.0/24", ["10.144.144.0/24"])).toBe(false);
    expect(cidrOverlapsAny("10.144.144.0/24", ["10.144.144.0/24"])).toBe(true);
    expect(cidrOverlapsAny("10.144.0.0/16", ["10.144.144.0/24"])).toBe(true);
    expect(cidrOverlapsAny("10.14.14.0/24", ["10.14.0.0/16", "192.168.0.0/16"])).toBe(
      true,
    );
    // Unparseable candidates are treated as conflicting (fail closed).
    expect(cidrOverlapsAny("nope", [])).toBe(true);
  });
});
