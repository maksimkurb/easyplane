import { describe, expect, it, vi } from "vitest";

import type { Device } from "../../src/db/schema.js";
import type { RealtimeEvent } from "../../src/realtime/events.js";
import type { RealtimeHub } from "../../src/realtime/hub.js";
import {
  DeviceService,
  type DeviceServiceOptions,
} from "../../src/services/device-service.js";

function device(overrides: Partial<Device> = {}): Device {
  const now = new Date("2026-01-01T12:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    networkId: "33333333-3333-4333-8333-333333333333",
    machineId: "44444444-4444-4444-8444-444444444444",
    hostname: "node-1",
    easytierVersion: "2.6.4",
    osType: "linux",
    osVersion: "6.8",
    osDistribution: "debian",
    sourceIp: "10.0.0.1",
    state: "approved",
    role: "member",
    inviteId: null,
    virtualIpv4: "10.144.144.2",
    dnsName: "node-1",
    ownerUserId: null,
    description: null,
    advertisedEndpoints: [],
    listenPort: null,
    externalPort: null,
    publicIps: [],
    isHub: false,
    wgListenPort: null,
    wgPrivateKeyCiphertext: null,
    reportedState: {},
    reportedStateAt: null,
    desiredRevision: 1,
    appliedRevision: 1,
    appliedAt: now,
    manualRoutesEnforcedAt: null,
    lastPushError: null,
    lastPushAt: null,
    lastSeenAt: new Date(),
    approvedAt: now,
    approvedBy: null,
    blockedAt: null,
    blockedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup() {
  const publish = vi.fn();
  const service = new DeviceService({
    onlineTimeoutMs: 5_000,
    unknownTokenLimitPerMinute: 100,
    realtime: { publish } as unknown as RealtimeHub,
  } as unknown as DeviceServiceOptions);
  const events = () => publish.mock.calls.map(([event]) => event as RealtimeEvent);
  return { publish, service, events };
}

describe("device realtime dedupe", () => {
  it("publishes a baseline once and then suppresses unchanged heartbeats", () => {
    const { service, events } = setup();
    const row = device();

    expect(service.publishDevice(row, "heartbeat")).toBe(true);
    expect(events()).toHaveLength(1);
    expect(events()[0]?.type).toBe("device.updated");
    expect(
      (events()[0]?.data as { changed: string[] }).changed,
    ).toEqual([]);

    // Same status, heartbeat every second: no event, even outside any
    // "cooldown" window (the old implementation re-emitted every 5 s).
    expect(service.publishDevice(row, "heartbeat")).toBe(false);
    expect(service.publishDevice(row, "heartbeat")).toBe(false);
    expect(events()).toHaveLength(1);
  });

  it("never publishes a lastSeen-only heartbeat", () => {
    const { service, events } = setup();
    const row = device();
    service.publishDevice(row, "heartbeat");

    const refreshed = device({ lastSeenAt: new Date(Date.now() + 60_000) });
    expect(service.publishDevice(refreshed, "heartbeat")).toBe(false);
    expect(events()).toHaveLength(1);
  });

  it("publishes when the online state really flips", () => {
    const { service, events } = setup();
    service.publishDevice(device(), "heartbeat");
    const offline = device({ lastSeenAt: new Date(Date.now() - 60_000) });

    expect(service.publishDevice(offline, "heartbeat")).toBe(true);
    const data = events()[1]?.data as {
      online: string;
      changed: string[];
      reason: string;
    };
    expect(data.online).toBe("offline");
    expect(data.reason).toBe("heartbeat");
    expect(data.changed).toContain("online");
  });

  it("publishes status changes once, not on the following heartbeat", () => {
    const { service, events } = setup();
    service.publishDevice(device(), "heartbeat");

    const applied = device({ appliedRevision: 2, appliedAt: new Date() });
    expect(service.publishDevice(applied, "config-pushed")).toBe(true);
    expect(service.publishDevice(applied, "heartbeat")).toBe(false);

    const data = events()[1]?.data as { changed: string[] };
    expect(data.changed).toContain("appliedRevision");
    expect(data.changed).not.toContain("online");
  });

  it("always publishes explicit reasons even when the status is unchanged", () => {
    const { service, events } = setup();
    const row = device();
    service.publishDevice(row, "heartbeat");

    // A rename changes fields the status signature does not track.
    expect(service.publishDevice(row, "renamed")).toBe(true);
    expect(events()).toHaveLength(2);
    expect((events()[1]?.data as { reason: string }).reason).toBe("renamed");
  });

  it("reports a state change so the client can refetch counts", () => {
    const { service, events } = setup();
    service.publishDevice(device(), "heartbeat");
    expect(
      service.publishDevice(device({ state: "blocked" }), "blocked"),
    ).toBe(true);
    const data = events()[1]?.data as { changed: string[]; state: string };
    expect(data.state).toBe("blocked");
    expect(data.changed).toContain("state");
  });

  it("does nothing without a realtime hub", () => {
    const service = new DeviceService({
      onlineTimeoutMs: 5_000,
      unknownTokenLimitPerMinute: 100,
    } as unknown as DeviceServiceOptions);
    expect(service.publishDevice(device(), "heartbeat")).toBe(false);
  });
});
