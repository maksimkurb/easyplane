import { describe, expect, it } from "vitest";

import { manage } from "@easyplane/proto";
import {
  DRIFT_BACKOFF_CAP_MS,
  DRIFT_BACKOFF_START_MS,
  desiredFingerprint,
  driftBackoffMs,
  nextDriftState,
  readDriftState,
  shouldBackOff,
  withoutDriftState,
} from "@easyplane/server";

function config(overrides: Partial<manage.NetworkConfig> = {}): manage.NetworkConfig {
  return {
    instanceId: "11111111-1111-4111-8111-111111111111",
    hostname: "hub",
    networkName: "lab",
    networkSecret: "secret",
    networkingMethod: manage.NetworkingMethod.Standalone,
    dhcp: false,
    virtualIpv4: "10.144.144.2",
    networkLength: 24,
    peerUrls: [],
    listenerUrls: [],
    proxyCidrs: [],
    routes: [],
    exitNodes: [],
    mappedListeners: [],
    portForwards: [],
    managedCredentials: [],
    peers: [],
    relayNetworkWhitelist: [],
    ...overrides,
  } as manage.NetworkConfig;
}

describe("config drift backoff", () => {
  it("follows 15s -> 30s -> 1m -> ... and caps at 15 minutes", () => {
    expect(driftBackoffMs(1)).toBe(DRIFT_BACKOFF_START_MS);
    expect(driftBackoffMs(2)).toBe(30_000);
    expect(driftBackoffMs(3)).toBe(60_000);
    expect(driftBackoffMs(4)).toBe(120_000);
    expect(driftBackoffMs(5)).toBe(240_000);
    expect(driftBackoffMs(6)).toBe(480_000);
    expect(driftBackoffMs(7)).toBe(DRIFT_BACKOFF_CAP_MS);
    expect(driftBackoffMs(50)).toBe(DRIFT_BACKOFF_CAP_MS);
    // Corrupt persisted counters must not produce NaN/Infinity.
    expect(driftBackoffMs(0)).toBe(DRIFT_BACKOFF_START_MS);
    expect(driftBackoffMs(-3)).toBe(DRIFT_BACKOFF_START_MS);
    expect(driftBackoffMs(Number.NaN)).toBe(DRIFT_BACKOFF_START_MS);
    expect(Number.isFinite(driftBackoffMs(1e9))).toBe(true);
  });

  it("increments only while the desired fingerprint stays the same", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = nextDriftState(null, {
      fingerprint: "a",
      reason: "vpnPortalConfig: missing on the client",
      now,
    });
    expect(first.attempts).toBe(1);
    expect(first.nextRetryAt).toBe("2026-01-01T00:00:15.000Z");

    const second = nextDriftState(first, {
      fingerprint: "a",
      reason: "vpnPortalConfig: missing on the client",
      now: new Date("2026-01-01T00:00:15.000Z"),
    });
    expect(second.attempts).toBe(2);
    expect(second.nextRetryAt).toBe("2026-01-01T00:00:45.000Z");

    // A new desired config must not inherit the old 15-minute wait.
    const changed = nextDriftState(second, {
      fingerprint: "b",
      reason: "hostname differs",
      now: new Date("2026-01-01T00:00:16.000Z"),
    });
    expect(changed.attempts).toBe(1);
    expect(changed.nextRetryAt).toBe("2026-01-01T00:00:31.000Z");
  });

  it("skips only inside the window of the same fingerprint", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const state = nextDriftState(null, { fingerprint: "a", reason: "differs", now });
    expect(shouldBackOff(state, "a", new Date("2026-01-01T00:00:14.000Z"))).toBe(true);
    expect(shouldBackOff(state, "a", new Date("2026-01-01T00:00:15.000Z"))).toBe(false);
    expect(shouldBackOff(state, "b", new Date("2026-01-01T00:00:01.000Z"))).toBe(false);
    expect(shouldBackOff(null, "a", now)).toBe(false);
  });

  it("persists and clears the record in reported_state", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const state = nextDriftState(null, { fingerprint: "a", reason: "differs", now });
    const reported = { managedConfigPermission: 0, drift: state };
    expect(readDriftState(reported)).toEqual(state);
    const cleared = withoutDriftState(reported);
    expect(cleared).toEqual({ managedConfigPermission: 0 });
    expect(readDriftState(cleared)).toBeNull();
    // Malformed records are ignored rather than trusted.
    expect(readDriftState({ drift: { attempts: 3 } })).toBeNull();
    expect(readDriftState({ drift: "oops" })).toBeNull();
    expect(readDriftState(null)).toBeNull();
  });
});

describe("desired config fingerprint", () => {
  it("is stable across object key order and independent of arrays order", () => {
    const a = config({ peerUrls: ["tcp://a:11010", "tcp://b:11010"] });
    const b = { ...a };
    expect(desiredFingerprint(a)).toBe(desiredFingerprint(b));
    expect(desiredFingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the desired config changes", () => {
    const base = config();
    expect(desiredFingerprint(base)).not.toBe(
      desiredFingerprint(config({ hostname: "other" })),
    );
    expect(desiredFingerprint(base)).not.toBe(
      desiredFingerprint(config({ peerUrls: ["tcp://peer:11010"] })),
    );
    expect(desiredFingerprint(base)).not.toBe(
      desiredFingerprint(
        config({
          vpnPortalConfig: {
            wireguardListen: "0.0.0.0:11013",
            wireguardPrivateKey: "key",
            clients: [],
          },
        }),
      ),
    );
  });

  it("does not leak the secret into the hash string", () => {
    const fingerprint = desiredFingerprint(config({ networkSecret: "top-secret" }));
    expect(fingerprint).not.toContain("top-secret");
  });
});
