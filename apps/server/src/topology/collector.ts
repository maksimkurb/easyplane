import { getNetworkById, listDevicesInNetwork } from "../db/repositories.js";
import type { DbExecutor } from "../db/repositories.js";
import type { Device } from "../db/schema.js";
import type { Logger } from "../logger.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { DeviceSessionRegistry } from "../services/device-sessions.js";
import { instanceIdFor } from "../services/push-service.js";
import type { ManagedClient } from "../control/managed-client.js";
import {
  deriveTopology,
  type NetworkTopologySnapshot,
  type TopologyObserverInput,
} from "./derive.js";
import {
  mapWithConcurrency,
  nextTopologyDelay,
  normalizeTopologyIntervals,
  type TopologyIntervalOptions,
} from "./scheduler.js";

export interface TopologyServiceOptions extends TopologyIntervalOptions {
  db: DbExecutor;
  sessions: DeviceSessionRegistry;
  realtime: RealtimeHub;
  logger: Logger;
  /** Parallel `CollectNetworkInfo` calls. */
  concurrency?: number;
  /** Per-device RPC timeout; a slow client must not stall the cycle. */
  deviceTimeoutMs?: number;
  /** Probes per network cycle; bounds load on a large fleet. */
  maxDevicesPerCycle?: number;
  /** How often to look for new networks, independent of the map interval. */
  discoveryIntervalMs?: number;
  random?: () => number;
  now?: () => number;
}

export interface CollectResult {
  snapshot: NetworkTopologySnapshot;
  /** True when this call ran a fresh probe instead of returning a cached one. */
  collected: boolean;
}

/**
 * Periodic `CollectNetworkInfo` fan-out and the latest snapshot per network.
 *
 * One snapshot per network is kept in memory; it is replaced atomically and
 * never grows. The map reads it over REST and receives the same object over SSE
 * (without the raw observation payload, which is only needed by the drawer).
 */
export class TopologyService {
  private readonly snapshots = new Map<string, NetworkTopologySnapshot>();
  private readonly generations = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Map<string, Promise<CollectResult>>();
  private discoveryTimer: NodeJS.Timeout | undefined;
  private stopped = true;
  private readonly intervals: Required<TopologyIntervalOptions>;
  private readonly concurrency: number;
  private readonly deviceTimeoutMs: number;
  private readonly maxDevicesPerCycle: number;
  private readonly discoveryIntervalMs: number;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: TopologyServiceOptions) {
    this.intervals = normalizeTopologyIntervals(options);
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.deviceTimeoutMs = Math.max(500, options.deviceTimeoutMs ?? 5_000);
    this.maxDevicesPerCycle = Math.max(1, options.maxDevicesPerCycle ?? 500);
    this.discoveryIntervalMs = Math.max(1_000, options.discoveryIntervalMs ?? 15_000);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
  }

  get intervalOptions(): Required<TopologyIntervalOptions> {
    return this.intervals;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.discover();
    this.discoveryTimer = setInterval(() => void this.discover(), this.discoveryIntervalMs);
    this.discoveryTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = undefined;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.inFlight.values()]);
  }

  /** Last snapshot for a network, if one was collected. */
  getSnapshot(networkId: string): NetworkTopologySnapshot | undefined {
    return this.snapshots.get(networkId);
  }

  /** Number of networks with a stored snapshot (bounded memory). */
  get snapshotCount(): number {
    return this.snapshots.size;
  }

  /**
   * Returns a cached snapshot when it is younger than `maxAgeMs`, otherwise
   * collects one. Concurrent callers share the in-flight cycle.
   */
  async getOrCollect(
    networkId: string,
    maxAgeMs = this.activeIntervalMs(),
  ): Promise<CollectResult> {
    const existing = this.snapshots.get(networkId);
    if (existing) {
      const age = this.now() - Date.parse(existing.collectedAt);
      if (age >= 0 && age <= maxAgeMs) {
        return { snapshot: existing, collected: false };
      }
    }
    return this.collect(networkId, "api");
  }

  collect(networkId: string, reason: string): Promise<CollectResult> {
    const inFlight = this.inFlight.get(networkId);
    if (inFlight) return inFlight;
    const task = this.collectInner(networkId, reason).finally(() => {
      this.inFlight.delete(networkId);
    });
    this.inFlight.set(networkId, task);
    return task;
  }

  private activeIntervalMs(): number {
    return this.intervals.activeIntervalMs;
  }

  /** Ensures a timer exists for every network and drops deleted ones. */
  private async discover(): Promise<void> {
    if (this.stopped) return;
    try {
      const networks = await this.options.db.query.networks.findMany();
      const seen = new Set<string>();
      for (const network of networks) {
        seen.add(network.id);
        if (!this.timers.has(network.id)) this.schedule(network.id);
      }
      for (const networkId of [...this.timers.keys()]) {
        if (seen.has(networkId)) continue;
        const timer = this.timers.get(networkId);
        if (timer) clearTimeout(timer);
        this.timers.delete(networkId);
        this.snapshots.delete(networkId);
        this.generations.delete(networkId);
      }
    } catch (error) {
      this.options.logger.debug("topology discovery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private schedule(networkId: string): void {
    if (this.stopped) return;
    const previous = this.timers.get(networkId);
    if (previous) clearTimeout(previous);
    const active = this.options.realtime.topologyWatchers(networkId) > 0;
    const delay = nextTopologyDelay(
      { ...this.intervals, active },
      this.random,
    );
    const timer = setTimeout(() => {
      this.timers.delete(networkId);
      void this.collect(networkId, "scheduled")
        .catch((error: unknown) => {
          this.options.logger.debug("scheduled topology collection failed", {
            networkId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => this.schedule(networkId));
    }, delay);
    timer.unref?.();
    this.timers.set(networkId, timer);
  }

  private async collectInner(
    networkId: string,
    reason: string,
  ): Promise<CollectResult> {
    const startedAt = this.now();
    const network = await getNetworkById(this.options.db, networkId);
    if (!network) {
      throw new Error(`network ${networkId} not found`);
    }
    const devices = (await listDevicesInNetwork(this.options.db, networkId)).filter(
      (device) => device.state === "approved",
    );
    const limited = devices.slice(0, this.maxDevicesPerCycle);
    const truncated = devices.length > limited.length;

    const online: Array<{ device: Device; client: ManagedClient }> = [];
    const offline: Device[] = [];
    for (const device of limited) {
      const client = this.options.sessions.get(device.id);
      if (client && !client.isClosed) online.push({ device, client });
      else offline.push(device);
    }

    const probes = await mapWithConcurrency(
      online,
      this.concurrency,
      async ({ device, client }) => {
        const instanceId = instanceIdFor(networkId, device.id);
        try {
          const response = await withTimeout(
            client.remote.collectNetworkInfo([instanceId]),
            this.deviceTimeoutMs,
            `CollectNetworkInfo(${device.id}) timed out`,
          );
          const info = response.info?.map[instanceId];
          if (!info) {
            return {
              device,
              input: {
                deviceId: device.id,
                hostname: device.dnsName ?? device.hostname,
                virtualIpv4: device.virtualIpv4,
                online: true,
                error: "the client reported no data for its managed instance",
              } satisfies TopologyObserverInput,
              failed: true,
            };
          }
          return {
            device,
            input: {
              deviceId: device.id,
              hostname: device.dnsName ?? device.hostname,
              virtualIpv4: device.virtualIpv4,
              online: true,
              info,
              error: info.errorMsg ?? null,
              collectedAt: this.now(),
            } satisfies TopologyObserverInput,
            failed: Boolean(info.errorMsg),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.options.logger.debug("topology probe failed", {
            deviceId: device.id,
            error: message,
          });
          return {
            device,
            input: {
              deviceId: device.id,
              hostname: device.dnsName ?? device.hostname,
              virtualIpv4: device.virtualIpv4,
              online: true,
              error: message,
            } satisfies TopologyObserverInput,
            failed: true,
          };
        }
      },
    );

    const inputs: TopologyObserverInput[] = probes.map((probe) => probe.input);
    for (const device of offline) {
      inputs.push({
        deviceId: device.id,
        hostname: device.dnsName ?? device.hostname,
        virtualIpv4: device.virtualIpv4,
        online: false,
        error: null,
      });
    }
    if (truncated) {
      this.options.logger.warn("topology cycle truncated", {
        networkId,
        devices: devices.length,
        probed: limited.length,
      });
    }

    const generation = (this.generations.get(networkId) ?? 0) + 1;
    this.generations.set(networkId, generation);
    const active = this.options.realtime.topologyWatchers(networkId) > 0;
    const snapshot = deriveTopology(inputs, {
      networkId,
      generation,
      collectedAt: this.now(),
      intervalMs: active
        ? this.intervals.activeIntervalMs
        : this.intervals.idleIntervalMs,
    });
    snapshot.partial = snapshot.partial || truncated || probes.some((probe) => probe.failed);

    this.snapshots.set(networkId, snapshot);
    this.options.realtime.publish({
      type: "topology.updated",
      orgId: network.orgId,
      networkId,
      data: {
        networkId,
        collectedAt: snapshot.collectedAt,
        nodes: snapshot.nodes,
        links: snapshot.links,
      },
    });
    this.options.logger.debug("topology collected", {
      networkId,
      reason,
      devices: devices.length,
      online: online.length,
      nodes: snapshot.stats.nodes,
      links: snapshot.stats.links,
      relayed: snapshot.stats.relayedLinks,
      durationMs: this.now() - startedAt,
    });
    return { snapshot, collected: true };
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
