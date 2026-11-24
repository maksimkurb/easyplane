import { getNetworkById, listDevicesInNetwork, listWireguardClients, updateDevice } from "../db/repositories.js";
import type { DbExecutor } from "../db/repositories.js";
import type { Device } from "../db/schema.js";
import { normalizePublicIpv4List } from "../domain/hub.js";
import type { Logger } from "../logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { METRIC_NAMES } from "../observability/metrics.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { DeviceSessionRegistry } from "../services/device-sessions.js";
import { instanceIdFor } from "../services/push-service.js";
import type { ManagedClient } from "../control/managed-client.js";
import {
  deriveTopology,
  type NetworkTopologySnapshot,
  type TopologyObserverInput,
} from "./derive.js";import {
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
  metrics?: MetricsRegistry;
  /**
   * Called after a successful probe of an online device that runs a WireGuard
   * portal. The app wires it to the WireGuard service's status collector.
   */
  probeWireguardPortal?: (device: Device, client: ManagedClient) => Promise<void>;
  /**
   * Called after a probe changed the durable public IPv4 list of a device.
   * The app wires this to the push service; the collector itself stays free
   * of peer-list logic.
   */
  onPublicIpsChanged?: (change: {
    device: Device;
    previousPublicIps: string[];
    publicIps: string[];
  }) => Promise<void> | void;
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
      const networks = await this.options.db.query.networks.findMany({
        orderBy: (table, { asc }) => [asc(table.id)],
      });
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
    this.options.metrics?.inc(METRIC_NAMES.topologyCycles, { reason });
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
          if (device.wgListenPort !== null) {
            try {
              await this.options.probeWireguardPortal?.(device, client);
            } catch (error) {
              this.options.logger.debug("WireGuard portal probe failed", {
                deviceId: device.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
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

    // WireGuard clients are not EasyTier peers, so they never appear in a
    // `CollectNetworkInfo` response. They are part of the network's device
    // picture, though, so the map gets one node per client plus a link to the
    // hub whose portal serves it.
    await this.appendWireguardNodes(snapshot, limited, offline);

    const previousSnapshot = this.snapshots.get(networkId);
    const graphChanged =
      previousSnapshot === undefined ||
      topologyFingerprint(previousSnapshot) !== topologyFingerprint(snapshot);
    this.snapshots.set(networkId, snapshot);

    // Keep the last public IPv4 addresses durably: the advertised hub endpoint
    // is built from them, and an offline device must not lose its address
    // between topology probes. A probe with no STUN answer keeps the old value.
    const changes: Array<{
      device: Device;
      previousPublicIps: string[];
      publicIps: string[];
    }> = [];
    for (const probe of probes) {
      const node = snapshot.nodes.find(
        (candidate) => candidate.deviceId === probe.device.id,
      );
      if (!node?.online) continue;
      const publicIps = normalizePublicIpv4List(node.publicIps);
      if (publicIps.length === 0) continue;
      if (sameAddresses(probe.device.publicIps, publicIps)) continue;
      try {
        const updated = await updateDevice(this.options.db, probe.device.id, {
          publicIps,
        });
        if (updated) {
          changes.push({
            device: updated,
            previousPublicIps: probe.device.publicIps,
            publicIps,
          });
        }
      } catch (error) {
        this.options.logger.debug("failed to store public IPs", {
          deviceId: probe.device.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const change of changes) {
      try {
        await this.options.onPublicIpsChanged?.(change);
      } catch (error) {
        this.options.logger.debug("public IP change handler failed", {
          deviceId: change.device.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // No watcher, no payload: the REST reader gets the snapshot from memory,
    // and the next map open triggers a fresh collection. An unchanged graph is
    // not re-published either, so an open map is not woken up by a timer.
    if (graphChanged && this.options.realtime.topologyWatchers(networkId) > 0) {
      this.options.realtime.publish({
        type: "topology.updated",
        orgId: network.orgId,
        networkId,
        data: {
          networkId,
          collectedAt: snapshot.collectedAt,
          nodes: snapshot.nodes,
          links: snapshot.links,
          stats: snapshot.stats,
        },
      });
    }
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

  /**
   * Adds one node per WireGuard portal client and a `wg` link to its hub. The
   * link is not measured: the portal reports whether the client is connected,
   * not its latency, so the node is online/offline and the link carries no
   * latency or loss instead of invented values.
   */
  private async appendWireguardNodes(
    snapshot: NetworkTopologySnapshot,
    ...deviceLists: Device[][]
  ): Promise<void> {
    let clients;
    try {
      clients = await listWireguardClients(this.options.db, snapshot.networkId);
    } catch (error) {
      this.options.logger.debug("failed to read WireGuard clients for the map", {
        networkId: snapshot.networkId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (clients.length === 0) return;
    const devices = new Map<string, Device>();
    for (const list of deviceLists) {
      for (const device of list) devices.set(device.id, device);
    }
    const nodeByDeviceId = new Map<string, NetworkTopologySnapshot["nodes"][number]>();
    for (const node of snapshot.nodes) {
      if (node.deviceId) nodeByDeviceId.set(node.deviceId, node);
    }
    for (const client of clients) {
      const hubNode = nodeByDeviceId.get(client.hubDeviceId);
      const hub = devices.get(client.hubDeviceId);
      if (!hubNode || !hub) continue;
      const status =
        client.reportedStatus && typeof client.reportedStatus === "object"
          ? (client.reportedStatus as Record<string, unknown>)
          : {};
      const online = status.state === "online";
      const nodeId = `wg:${client.id}`;
      // The hub also lists an attached portal client as an ordinary peer, so
      // the same client would appear twice: once from the route table (often
      // reported offline) and once from the portal. The portal node wins.
      const clientIp = client.virtualIpv4.split("/")[0];
      const phantomIds = new Set(
        snapshot.nodes
          .filter(
            (node) =>
              !node.managed &&
              node.kind !== "wireguard" &&
              ((typeof status.peerId === "number" && node.peerId === status.peerId) ||
                (node.virtualIpv4 !== null &&
                  node.virtualIpv4.split("/")[0] === clientIp)),
          )
          .map((node) => node.id),
      );
      if (phantomIds.size > 0) {
        snapshot.nodes = snapshot.nodes.filter((node) => !phantomIds.has(node.id));
        snapshot.links = snapshot.links.filter(
          (link) => !phantomIds.has(link.source) && !phantomIds.has(link.target),
        );
      }
      snapshot.nodes.push({
        id: nodeId,
        deviceId: null,
        hostname: client.name,
        virtualIpv4: client.virtualIpv4,
        networkLength: null,
        version: "",
        managed: false,
        online,
        peerId: typeof status.peerId === "number" ? status.peerId : null,
        natType: "Unknown",
        tcpNatType: "Unknown",
        natFriendly: false,
        publicIps: [],
        listeners: [],
        proxyCidrs: [],
        featureFlags: {
          isPublicServer: false,
          avoidRelayData: false,
          disableP2p: false,
          quicInput: false,
          kcpInput: false,
        },
        // A portal client dials the hub; it is not a public/relay-capable peer.
        reachable: false,
        relayCapable: false,
        capabilityReasons: ["WireGuard portal client"],
        relaysFor: [],
        observed: false,
        kind: "wireguard",
      });
      snapshot.links.push({
        id: `wg-link:${client.id}`,
        source: hubNode.id,
        target: nodeId,
        kind: "direct",
        via: null,
        viaHostname: null,
        protocol: "wg",
        rawTunnelType: "wireguard",
        latencyMs: null,
        lossPercent: null,
        cost: 1,
        pathLatencyMs: null,
        direction: "acceptor",
        localAddr: null,
        remoteAddr:
          typeof status.endpoint === "string" && status.endpoint.length > 0
            ? status.endpoint
            : null,
        protocolIsFirstHop: true,
        asymmetric: false,
        observedBy: [hubNode.id],
        evidence: [],
      });
    }
    snapshot.stats.nodes = snapshot.nodes.length;
    snapshot.stats.managedNodes = snapshot.nodes.filter((node) => node.managed).length;
    snapshot.stats.links = snapshot.links.length;
    snapshot.stats.directLinks = snapshot.links.filter(
      (link) => link.kind === "direct",
    ).length;
    snapshot.stats.relayedLinks = snapshot.links.filter(
      (link) => link.kind === "relayed",
    ).length;
    snapshot.stats.reachableNodes = snapshot.nodes.filter(
      (node) => node.reachable,
    ).length;
    snapshot.stats.hasReachableNode = snapshot.stats.reachableNodes > 0;
  }
}

function sameAddresses(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((address) => set.has(address));
}

/**
 * Everything the map renders, excluding collection bookkeeping. `collectedAt`,
 * `generation`, `intervalMs` and the raw observations change every cycle even
 * when the graph is identical, so they must not count as a real update.
 */
function topologyFingerprint(snapshot: NetworkTopologySnapshot): string {
  return JSON.stringify({
    partial: snapshot.partial,
    nodes: snapshot.nodes,
    links: snapshot.links,
    stats: snapshot.stats,
  });
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
