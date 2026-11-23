import { describe, expect, it } from "vitest";

import { computeDeviceStatus } from "@easyplane/server";

const now = new Date("2026-01-01T00:00:10Z");

function status(overrides: Partial<Parameters<typeof computeDeviceStatus>[0]>) {
  return computeDeviceStatus({
    state: "approved",
    lastSeenAt: new Date("2026-01-01T00:00:09Z"),
    now,
    onlineTimeoutMs: 5000,
    desiredRevision: 3,
    appliedRevision: 3,
    lastPushError: null,
    ...overrides,
  });
}

describe("device status machine", () => {
  it("reports pending devices as online but not applicable for sync", () => {
    expect(status({ state: "pending", desiredRevision: null, appliedRevision: null })).toEqual({
      state: "pending",
      online: "online",
      sync: "not-applicable",
      label: "pending/online/not-applicable",
    });
  });

  it("reports approved + fresh heartbeat + equal revisions as in sync", () => {
    expect(status({})).toEqual({
      state: "approved",
      online: "online",
      sync: "in-sync",
      label: "approved/online/in-sync",
    });
  });

  it("treats a newer applied revision as in sync", () => {
    expect(status({ desiredRevision: 2, appliedRevision: 5 }).sync).toBe("in-sync");
  });

  it("marks a stale heartbeat offline", () => {
    const result = status({ lastSeenAt: new Date("2026-01-01T00:00:01Z") });
    expect(result.online).toBe("offline");
    expect(result.label).toBe("approved/offline/in-sync");
  });

  it("treats a missing heartbeat as offline", () => {
    expect(status({ lastSeenAt: null }).online).toBe("offline");
  });

  it("marks an approved device without an applied revision as stale", () => {
    expect(status({ appliedRevision: null })).toMatchObject({
      online: "online",
      sync: "stale",
    });
  });

  it("marks applied < desired as stale", () => {
    expect(status({ desiredRevision: 4, appliedRevision: 3 }).sync).toBe("stale");
  });

  it("marks a device with an active config drift as stale, not in-sync", () => {
    // The instance is running the desired revision but reports a different
    // config; the panel is backing off, so silence must not look healthy.
    expect(status({ driftPending: true })).toMatchObject({
      online: "online",
      sync: "stale",
    });
    // A real push error still wins over drift.
    expect(status({ driftPending: true, lastPushError: "boom" }).sync).toBe("error");
  });

  it("marks a push error as error even when revisions match", () => {
    expect(status({ lastPushError: "boom" }).sync).toBe("error");
  });

  it("ignores an empty push error", () => {
    expect(status({ lastPushError: "" }).sync).toBe("in-sync");
  });

  it("reports blocked devices as offline and not applicable", () => {
    expect(
      status({ state: "blocked", lastSeenAt: now, lastPushError: "blocked" }),
    ).toEqual({
      state: "blocked",
      online: "offline",
      sync: "not-applicable",
      label: "blocked/offline/not-applicable",
    });
  });

  it("approved devices without a desired revision have nothing to sync", () => {
    expect(
      status({ desiredRevision: null, appliedRevision: null }).sync,
    ).toBe("not-applicable");
  });
});
