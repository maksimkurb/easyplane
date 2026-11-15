import { randomUUID } from "node:crypto";

import {
  defaultTopics,
  type RealtimeEvent,
  type RealtimeEventInput,
  type RealtimeTopic,
} from "./events.js";

export interface RealtimeIdentity {
  userId: string;
  orgId: string;
  role: "admin" | "member" | "viewer";
  email: string;
}

export interface RealtimeSubscriptionOptions {
  /** Restrict delivery to these networks (the panel always knows them). */
  networkIds?: string[];
  /** What the connection displays; used only to decide adaptive polling. */
  topics?: RealtimeTopic[];
  /** `Last-Event-ID` from a reconnect; drives replay or a resync marker. */
  lastEventId?: number;
}

export interface RealtimeSubscriber {
  id: string;
  identity: RealtimeIdentity;
  networkIds: Set<string> | null;
  topics: Set<RealtimeTopic>;
}

export interface RealtimeSubscription {
  subscriber: RealtimeSubscriber;
  /** Events to write before the live stream (oldest first). */
  replay: RealtimeEvent[];
  /** True when the client cannot be caught up and must refetch everything. */
  resync: boolean;
  /** Removes the subscription; idempotent. */
  close: () => void;
}

/** Raised when a user exceeds the bounded number of concurrent streams. */
export class RealtimeLimitError extends Error {
  readonly statusCode = 429;
  readonly code = "too_many_streams";

  constructor(message: string) {
    super(message);
    this.name = "RealtimeLimitError";
  }
}

export interface RealtimeHubOptions {
  /** Streams one user may hold open at once. */
  maxPerUser?: number;
  /** Hard cap across the deployment (defence against connection floods). */
  maxTotal?: number;
  /** How many recent events are kept for `Last-Event-ID` replay. */
  bufferSize?: number;
  now?: () => number;
}

type EventSink = (event: RealtimeEvent) => void;

/**
 * In-process fan-out for browser events.
 *
 * Deliberately small: one organisation per deployment, so events are kept in a
 * single bounded ring buffer. `seq` is process-local; after a restart the client
 * reconnects without a valid id and receives a `resync` marker instead of a
 * replay (see docs/REALTIME.md §4).
 */
export class RealtimeHub {
  private readonly subscribers = new Map<
    string,
    { subscriber: RealtimeSubscriber; sink: EventSink }
  >();
  private readonly buffer: RealtimeEvent[] = [];
  readonly maxPerUser: number;
  readonly maxTotal: number;
  private readonly bufferSize: number;
  private readonly now: () => number;
  private seq = 0;

  constructor(options: RealtimeHubOptions = {}) {
    this.maxPerUser = options.maxPerUser ?? 4;
    this.maxTotal = options.maxTotal ?? 1000;
    this.bufferSize = options.bufferSize ?? 500;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.subscribers.size;
  }

  get lastSequence(): number {
    return this.seq;
  }

  /** Number of live streams for one user (bounded, exposed for the health UI). */
  connectionsForUser(userId: string): number {
    let count = 0;
    for (const entry of this.subscribers.values()) {
      if (entry.subscriber.identity.userId === userId) count += 1;
    }
    return count;
  }

  subscribe(
    identity: RealtimeIdentity,
    options: RealtimeSubscriptionOptions,
    sink: EventSink,
  ): RealtimeSubscription {
    if (this.connectionsForUser(identity.userId) >= this.maxPerUser) {
      throw new RealtimeLimitError(
        `at most ${this.maxPerUser} live streams per user are allowed`,
      );
    }
    if (this.subscribers.size >= this.maxTotal) {
      throw new RealtimeLimitError("the server is at its live stream limit");
    }

    const subscriber: RealtimeSubscriber = {
      id: randomUUID(),
      identity,
      networkIds:
        options.networkIds && options.networkIds.length > 0
          ? new Set(options.networkIds)
          : null,
      topics: new Set(options.topics ?? []),
    };
    const entry = { subscriber, sink };
    this.subscribers.set(subscriber.id, entry);

    const { replay, resync } = this.planReplay(subscriber, options.lastEventId);

    let closed = false;
    return {
      subscriber,
      replay,
      resync,
      close: () => {
        if (closed) return;
        closed = true;
        this.subscribers.delete(subscriber.id);
      },
    };
  }

  /**
   * Replay events after `lastEventId` when they are still buffered. Returns
   * `resync` when the id is unknown (restart, evicted, or a client that never
   * saw an event), which tells the browser to invalidate every query.
   */
  private planReplay(
    subscriber: RealtimeSubscriber,
    lastEventId: number | undefined,
  ): { replay: RealtimeEvent[]; resync: boolean } {
    if (lastEventId === undefined || !Number.isFinite(lastEventId)) {
      return { replay: [], resync: false };
    }
    const oldest = this.buffer[0]?.seq;
    if (lastEventId > this.seq || (oldest !== undefined && lastEventId < oldest - 1)) {
      return { replay: [], resync: true };
    }
    const replay = this.buffer.filter(
      (event) => event.seq > lastEventId && this.matches(subscriber, event),
    );
    return { replay, resync: false };
  }

  private matches(subscriber: RealtimeSubscriber, event: RealtimeEvent): boolean {
    if (event.orgId !== subscriber.identity.orgId) return false;
    // Snapshot payloads are large; only streams that declared an interest in
    // the map receive them (the shell stream ignores topology entirely).
    if (event.type === "topology.updated" && !subscriber.topics.has("topology")) {
      return false;
    }
    if (
      subscriber.networkIds &&
      event.networkId !== undefined &&
      !subscriber.networkIds.has(event.networkId)
    ) {
      return false;
    }
    return true;
  }

  publish<K extends RealtimeEventInput["type"]>(
    input: RealtimeEventInput<K>,
  ): RealtimeEvent<K> {
    this.seq += 1;
    const event = {
      seq: this.seq,
      type: input.type,
      at: new Date(this.now()).toISOString(),
      orgId: input.orgId,
      networkId: input.networkId,
      deviceId: input.deviceId,
      topics: input.topics ?? defaultTopics(input.type),
      data: input.data,
    } as RealtimeEvent<K>;

    this.buffer.push(event as RealtimeEvent);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();

    for (const { subscriber, sink } of this.subscribers.values()) {
      if (!this.matches(subscriber, event as RealtimeEvent)) continue;
      try {
        sink(event as RealtimeEvent);
      } catch {
        // A broken stream must never break the publisher; the SSE layer
        // unsubscribes on socket close.
      }
    }
    return event;
  }

  /** Streams currently displaying the topology map for a network. */
  topologyWatchers(networkId: string): number {
    let count = 0;
    for (const { subscriber } of this.subscribers.values()) {
      if (!subscriber.topics.has("topology")) continue;
      if (subscriber.networkIds && !subscriber.networkIds.has(networkId)) continue;
      count += 1;
    }
    return count;
  }

  /** Test/diagnostic snapshot; never includes user credentials. */
  describe(): Array<{
    id: string;
    userId: string;
    role: string;
    networks: string[] | null;
    topics: string[];
  }> {
    return [...this.subscribers.values()].map(({ subscriber }) => ({
      id: subscriber.id,
      userId: subscriber.identity.userId,
      role: subscriber.identity.role,
      networks: subscriber.networkIds ? [...subscriber.networkIds] : null,
      topics: [...subscriber.topics],
    }));
  }

  closeAll(): void {
    this.subscribers.clear();
  }
}
