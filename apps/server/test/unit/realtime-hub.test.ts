import { describe, expect, it } from "vitest";

import {
  RealtimeHub,
  RealtimeLimitError,
  type RealtimeEvent,
} from "@easyplane/server";

const ADMIN = {
  userId: "user-admin",
  orgId: "org-1",
  role: "admin" as const,
  email: "admin@example.com",
};

function deviceEvent(networkId = "net-1") {
  return {
    type: "device.updated" as const,
    orgId: ADMIN.orgId,
    networkId,
    deviceId: "dev-1",
    data: {
      deviceId: "dev-1",
      networkId,
      state: "approved" as const,
      online: "online" as const,
      sync: "in-sync" as const,
      hostname: "core-a",
      virtualIpv4: "10.0.0.1",
      lastSeenAt: null,
      desiredRevision: 1,
      appliedRevision: 1,
      appliedAt: null,
      lastPushAt: null,
      lastPushError: null,
      reason: "heartbeat",
      changed: [],
    },
  };
}

describe("realtime hub", () => {
  it("assigns monotonic ids and fans out to matching subscribers", () => {
    const hub = new RealtimeHub({ now: () => 1_700_000_000_000 });
    const seen: RealtimeEvent[] = [];
    hub.subscribe(ADMIN, {}, (event) => seen.push(event));

    const first = hub.publish(deviceEvent());
    const second = hub.publish(deviceEvent());
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.at).toBe("2023-11-14T22:13:20.000Z");
    expect(seen.map((event) => event.seq)).toEqual([1, 2]);
    // Default topics come from the event type.
    expect(first.topics).toEqual(["devices"]);
  });

  it("filters by network and organisation", () => {
    const hub = new RealtimeHub();
    const netOne: RealtimeEvent[] = [];
    const netTwo: RealtimeEvent[] = [];
    hub.subscribe(ADMIN, { networkIds: ["net-1"] }, (event) => netOne.push(event));
    hub.subscribe(ADMIN, { networkIds: ["net-2"] }, (event) => netTwo.push(event));

    hub.publish(deviceEvent("net-1"));
    hub.publish(deviceEvent("net-2"));
    hub.publish({ ...deviceEvent("net-1"), orgId: "other-org" });

    expect(netOne).toHaveLength(1);
    expect(netTwo).toHaveLength(1);
  });

  it("bounds concurrent streams per user", () => {
    const hub = new RealtimeHub({ maxPerUser: 2 });
    hub.subscribe(ADMIN, {}, () => undefined);
    hub.subscribe(ADMIN, {}, () => undefined);
    expect(() => hub.subscribe(ADMIN, {}, () => undefined)).toThrowError(
      RealtimeLimitError,
    );
    expect(hub.connectionsForUser(ADMIN.userId)).toBe(2);

    // Another user is unaffected, and closing frees a slot.
    const other = { ...ADMIN, userId: "user-viewer", role: "viewer" as const };
    const second = hub.subscribe(other, {}, () => undefined);
    expect(hub.connectionsForUser(other.userId)).toBe(1);
    second.close();
    second.close(); // idempotent
    expect(hub.connectionsForUser(other.userId)).toBe(0);
  });

  it("bounds the total number of streams", () => {
    const hub = new RealtimeHub({ maxTotal: 2, maxPerUser: 10 });
    hub.subscribe(ADMIN, {}, () => undefined);
    hub.subscribe({ ...ADMIN, userId: "u2" }, {}, () => undefined);
    expect(() =>
      hub.subscribe({ ...ADMIN, userId: "u3" }, {}, () => undefined),
    ).toThrowError(/server is at its live stream limit/);
  });

  it("replays buffered events after Last-Event-ID", () => {
    const hub = new RealtimeHub({ bufferSize: 10 });
    for (let index = 0; index < 4; index += 1) hub.publish(deviceEvent());

    const subscription = hub.subscribe(ADMIN, { lastEventId: 2 }, () => undefined);
    expect(subscription.resync).toBe(false);
    expect(subscription.replay.map((event) => event.seq)).toEqual([3, 4]);
    subscription.close();
  });

  it("asks for a resync when the id is unknown or too old", () => {
    const hub = new RealtimeHub({ bufferSize: 2 });
    for (let index = 0; index < 4; index += 1) hub.publish(deviceEvent());

    expect(hub.subscribe(ADMIN, { lastEventId: 1 }, () => undefined).resync).toBe(
      true,
    );
    // A browser reconnecting after a server restart sees a future id? The hub
    // restarted, so its seq is lower than the client's last id.
    const restarted = new RealtimeHub();
    restarted.publish(deviceEvent());
    expect(
      restarted.subscribe(ADMIN, { lastEventId: 99 }, () => undefined).resync,
    ).toBe(true);
    // A client that never saw an event does not need a resync.
    expect(hub.subscribe(ADMIN, {}, () => undefined).resync).toBe(false);
  });

  it("delivers topology snapshots only to declared map watchers", () => {
    const hub = new RealtimeHub();
    const shellSeen: string[] = [];
    const mapSeen: string[] = [];
    hub.subscribe(ADMIN, {}, (event) => shellSeen.push(event.type));
    hub.subscribe(ADMIN, { topics: ["topology"], networkIds: ["net-1"] }, (event) =>
      mapSeen.push(event.type),
    );
    hub.publish({
      type: "topology.updated",
      orgId: ADMIN.orgId,
      networkId: "net-1",
      data: {
        networkId: "net-1",
        collectedAt: "now",
        nodes: [],
        links: [],
        stats: {},
      },
    });
    hub.publish(deviceEvent());
    expect(shellSeen).toEqual(["device.updated"]);
    // A map stream also receives ordinary events; it only *additionally* gets
    // the heavy snapshots.
    expect(mapSeen).toEqual(["topology.updated", "device.updated"]);
  });

  it("keeps topology snapshots out of the replay ring", () => {
    const hub = new RealtimeHub();
    hub.publish(deviceEvent()); // seq 1
    const snapshot = hub.publish({
      type: "topology.updated",
      orgId: ADMIN.orgId,
      networkId: "net-1",
      data: { networkId: "net-1", collectedAt: "now", nodes: [], links: [], stats: {} },
    });
    hub.publish(deviceEvent()); // seq 3
    expect(snapshot.seq).toBe(2);
    const subscription = hub.subscribe(ADMIN, { lastEventId: 1 }, () => undefined);
    // The reconnect gets the missed device event but no snapshot; the map
    // refetches the current snapshot, which is authoritative.
    expect(subscription.replay.map((event) => event.seq)).toEqual([3]);
  });

  it("counts topology watchers per network for adaptive polling", () => {
    const hub = new RealtimeHub();
    hub.subscribe(ADMIN, { topics: ["topology"], networkIds: ["net-1"] }, () => undefined);
    hub.subscribe(ADMIN, { topics: ["topology"] }, () => undefined);
    hub.subscribe(ADMIN, {}, () => undefined);
    expect(hub.topologyWatchers("net-1")).toBe(2);
    expect(hub.topologyWatchers("net-2")).toBe(1);
    expect(hub.size).toBe(3);
  });

  it("survives a throwing sink and keeps other subscribers alive", () => {
    const hub = new RealtimeHub();
    const seen: number[] = [];
    hub.subscribe(ADMIN, {}, () => {
      throw new Error("socket gone");
    });
    hub.subscribe(ADMIN, {}, (event) => seen.push(event.seq));
    expect(() => hub.publish(deviceEvent())).not.toThrow();
    expect(seen).toEqual([1]);
  });

  it("keeps the ring buffer bounded", () => {
    const hub = new RealtimeHub({ bufferSize: 3 });
    for (let index = 0; index < 10; index += 1) hub.publish(deviceEvent());
    // Only the newest three events are replayable.
    expect(hub.subscribe(ADMIN, { lastEventId: 6 }, () => undefined).resync).toBe(
      true,
    );
    expect(
      hub.subscribe(ADMIN, { lastEventId: 7 }, () => undefined).replay.map(
        (event) => event.seq,
      ),
    ).toEqual([8, 9, 10]);
  });
});
