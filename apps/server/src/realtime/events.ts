/**
 * Server -> browser realtime events.
 *
 * Transport is SSE (see docs/REALTIME.md for why SSE and not WebSocket). The
 * event names are stable API surface: the web panel maps them onto TanStack
 * Query cache invalidations, and the topology event carries the snapshot the
 * map renders.
 */

export type RealtimeTopic = "devices" | "network" | "policy" | "routes" | "topology";

export interface RealtimeEventData {
  "device.updated": {
    deviceId: string;
    networkId: string;
    state: "pending" | "approved" | "blocked";
    online: "online" | "offline";
    sync: "not-applicable" | "in-sync" | "stale" | "error";
    hostname: string;
    virtualIpv4: string | null;
    lastSeenAt: string | null;
    desiredRevision: number | null;
    appliedRevision: number | null;
    lastPushError: string | null;
    /** Why the event was emitted (heartbeat, push, approve, offline, ...). */
    reason: string;
  };
  "device.removed": { deviceId: string; networkId: string };
  "network.updated": { networkId: string; reason: string };
  "network.deleted": { networkId: string };
  "policy.updated": {
    networkId: string;
    version: number;
    revisionsCreated: number;
    mode?: "open" | "rules" | "json";
  };
  "tag.updated": {
    tagId: string;
    name?: string;
    deviceCount?: number;
    deleted?: boolean;
  };
  "user_group.updated": {
    groupId: string;
    name?: string;
    deleted?: boolean;
  };
  "route.updated": { networkId: string; routeId?: string; deviceId?: string };
  "topology.updated": {
    networkId: string;
    collectedAt: string;
    nodes: unknown[];
    links: unknown[];
    stats: unknown;
  };
  resync: { reason: string };
  hello: {
    user: { id: string; email: string; role: "admin" | "member" | "viewer" };
    heartbeatSeconds: number;
    /** Bounded number of concurrent streams allowed per user. */
    maxPerUser: number;
  };
}

export type RealtimeEventType = keyof RealtimeEventData;

export interface RealtimeEvent<K extends RealtimeEventType = RealtimeEventType> {
  /** Monotonic per-process sequence; doubles as the SSE event id. */
  seq: number;
  type: K;
  at: string;
  orgId: string;
  networkId?: string;
  deviceId?: string;
  /** Which cache families this event invalidates. */
  topics: RealtimeTopic[];
  data: RealtimeEventData[K];
}

/** Event as published by services, before the hub assigns seq/at. */
export type RealtimeEventInput<K extends RealtimeEventType = RealtimeEventType> = {
  type: K;
  orgId: string;
  networkId?: string;
  deviceId?: string;
  topics?: RealtimeTopic[];
} & { data: RealtimeEventData[K] };

/**
 * Default invalidation topics per event type. Services may override, e.g. a
 * device event that also changes the approval badge.
 */
export function defaultTopics(type: RealtimeEventType): RealtimeTopic[] {
  switch (type) {
    case "device.updated":
    case "device.removed":
      return ["devices"];
    case "network.updated":
    case "network.deleted":
      return ["network"];
    case "policy.updated":
    case "tag.updated":
    case "user_group.updated":
      return ["policy", "devices"];
    case "route.updated":
      return ["routes", "devices"];
    case "topology.updated":
      return ["topology"];
    case "resync":
    case "hello":
      return [];
  }
}
