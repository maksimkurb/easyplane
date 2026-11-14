import { acl, manage } from "@easyplane/proto";
import { protoToUuid } from "@easyplane/shared";

import type { ManagedClient } from "../control/managed-client.js";
import type { DbExecutor } from "../db/repositories.js";
import {
  approvedRoutesForNetwork,
  getDeviceById,
  getNetworkById,
  listRevisions,
  updateDevice,
} from "../db/repositories.js";
import type { Device, Network } from "../db/schema.js";
import {
  buildNetworkConfig,
  configMatchesDesired,
  normalizeDesiredConfig,
} from "../domain/desired-config.js";
import { parseIpv4 } from "../domain/ip.js";
import {
  acceptedRoutesFor,
  approvedExitNode,
  approvedSubnetCidrs,
  type ReportedInstance,
} from "../domain/routes.js";
import { deterministicUuid } from "../security/crypto.js";
import type { SecretBox } from "../security/crypto.js";
import type { Logger } from "../logger.js";
import type { AuditService } from "./audit.js";
import type { DeviceSessionRegistry } from "./device-sessions.js";

export interface PushResult {
  status: "pushed" | "already-in-sync" | "skipped" | "error";
  reason?: string;
  revision?: number;
}

export interface PushServiceOptions {
  db: DbExecutor;
  secretBox: SecretBox;
  sessions: DeviceSessionRegistry;
  audit: AuditService;
  logger: Logger;
  /** Poll interval while waiting for the instance to report running. */
  pollIntervalMs?: number;
  /** Number of polls before a push is considered failed. */
  pollAttempts?: number;
  /**
   * Compiler hook: returns the ACL for a device at a policy version. Wired to
   * PolicyService in the app context (kept as a function to avoid a service
   * dependency cycle).
   */
  compileAcl?: (
    network: Network,
    deviceId: string,
    policyVersion: number,
  ) => Promise<acl.Acl | undefined>;
  /** Persists what the client reports about its routes. */
  recordReport?: (device: Device, instances: ReportedInstance[]) => Promise<void>;
  /** Minimum gap between route reports per device. */
  reportIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function toIpv4Number(value: string | null): number {
  if (!value) return -1;
  try {
    return parseIpv4(value);
  } catch {
    return -1;
  }
}

export function instanceIdFor(networkId: string, deviceId: string): string {
  return deterministicUuid("easyplane.network-instance", networkId, deviceId);
}

/** Schedules a push for every approved device of a network. */
export async function pushNetworkDevices(
  db: DbExecutor,
  push: PushService,
  networkId: string,
  reason: string,
): Promise<number> {
  const rows = await db.query.devices.findMany({
    where: (table, { and, eq }) =>
      and(eq(table.networkId, networkId), eq(table.state, "approved")),
  });
  for (const device of rows) push.schedule(device.id, reason);
  return rows.length;
}

/**
 * Desired-state engine: builds the per-device NetworkConfig from the latest
 * revision, pushes it idempotently, verifies the instance is running and records
 * applied revision / error. Pushes happen on connect (heartbeat) and whenever a
 * revision, approval or address changes.
 */
export class PushService {
  private readonly inFlight = new Map<string, Promise<PushResult>>();
  private readonly queued = new Set<string>();
  private readonly lastReportAt = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(private readonly options: PushServiceOptions) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.reconcile().catch((error: unknown) => {
        this.options.logger.warn("reconcile failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled([...this.inFlight.values()]);
  }

  /** Fire-and-forget push; concurrent requests for one device are coalesced. */
  schedule(deviceId: string, reason: string): void {
    if (this.inFlight.has(deviceId)) {
      // A change landed while a push was running; run once more afterwards so
      // the newest revision wins instead of being lost.
      this.queued.add(deviceId);
      return;
    }
    void this.runExclusive(deviceId, () => this.ensureInner(deviceId)).catch(
      (error: unknown) => {
        this.options.logger.warn("scheduled push failed", {
          deviceId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        return { status: "error" as const, reason: "push failed" };
      },
    );
  }

  /** Waits for any in-flight push and returns the (possibly coalesced) result. */
  pushNow(deviceId: string): Promise<PushResult> {
    return this.runExclusive(deviceId, () => this.doPush(deviceId));
  }

  /**
   * One push per device at a time. A caller that arrives during a push joins it
   * and marks a follow-up run, so the newest revision is never dropped.
   */
  private runExclusive(
    deviceId: string,
    task: () => Promise<PushResult>,
  ): Promise<PushResult> {
    const existing = this.inFlight.get(deviceId);
    if (existing) {
      this.queued.add(deviceId);
      return existing;
    }
    const promise = task().finally(() => {
      this.inFlight.delete(deviceId);
      if (this.queued.delete(deviceId)) this.schedule(deviceId, "queued");
    });
    this.inFlight.set(deviceId, promise);
    return promise;
  }

  /**
   * Push only when the device is not already verifiably running the desired
   * revision. Used on every (re)connect, so a client that lost its instance
   * (restart, crash) converges again without operator action.
   */
  async ensure(deviceId: string): Promise<PushResult> {
    return this.runExclusive(deviceId, () => this.ensureInner(deviceId));
  }

  private async ensureInner(deviceId: string): Promise<PushResult> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device) return { status: "skipped", reason: "device not found" };
    if (device.state !== "approved") {
      return { status: "skipped", reason: `device is ${device.state}` };
    }
    const client = this.options.sessions.get(deviceId);
    if (!client) return { status: "skipped", reason: "offline" };

    const revisions = await listRevisions(this.options.db, deviceId);
    const latest = revisions[0];
    if (!latest) return { status: "skipped", reason: "no desired config" };

    if (
      device.appliedRevision !== null &&
      device.appliedRevision >= latest.revision
    ) {
      try {
        const instanceId = instanceIdFor(device.networkId, device.id);
        const listed = await client.remote.listNetworkInstance();
        if (listed.includes(instanceId)) {
          const reported = await client.remote.getNetworkInstanceConfig(instanceId);
          const network = await getNetworkById(this.options.db, device.networkId);
          if (network) {
            const desired = await this.desiredConfigFor(
              device,
              network,
              latest.config,
              latest.policyVersion,
            );
            if (configMatchesDesired(reported.config, desired)) {
              await this.collectReport(device, client);
              return {
                status: "already-in-sync",
                revision: latest.revision,
              };
            }
          }
        }
      } catch (error) {
        this.options.logger.debug("config verification failed; repushing", {
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.doPush(deviceId);
  }

  private async desiredConfigFor(
    device: Device,
    network: Network,
    rawConfig: Record<string, unknown>,
    policyVersion: number | null,
  ): Promise<manage.NetworkConfig> {
    const [approvedRoutes, compiledAcl] = await Promise.all([
      approvedRoutesForNetwork(this.options.db, network.id),
      this.aclFor(network, device, policyVersion),
    ]);
    return this.buildConfig(
      device,
      network,
      rawConfig,
      policyVersion,
      approvedRoutes,
      compiledAcl,
    );
  }

  private buildConfig(
    device: Device,
    network: Network,
    rawConfig: Record<string, unknown>,
    policyVersion: number | null,
    approvedRoutes: Awaited<ReturnType<typeof approvedRoutesForNetwork>>,
    compiledAcl: acl.Acl | undefined,
  ): manage.NetworkConfig {
    const stored = normalizeDesiredConfig(rawConfig);
    return buildNetworkConfig({
      networkId: network.id,
      deviceId: device.id,
      instanceId: instanceIdFor(network.id, device.id),
      hostname: device.dnsName ?? (device.hostname || "easyplane-device"),
      networkName: network.networkName,
      networkSecret: this.options.secretBox.decrypt(network.secretCiphertext),
      stored,
      assignedIpv4: device.virtualIpv4,
      ipv4Cidr: network.ipv4Cidr,
      magicDnsEnabled: network.magicDnsEnabled,
      proxyCidrs: approvedSubnetCidrs(approvedRoutes, device.id),
      enableExitNode: approvedExitNode(approvedRoutes, device.id),
      manualRoutes: stored.acceptRoutes
        ? acceptedRoutesFor(approvedRoutes, device.id)
        : [],
      acl: compiledAcl,
    });
  }

  /**
   * ACL for the revision being pushed. Revisions created before M2 have no
   * policy version; they follow the network's active policy.
   */
  private async aclFor(
    network: Network,
    device: Device,
    policyVersion: number | null,
  ): Promise<acl.Acl | undefined> {
    if (!this.options.compileAcl) return undefined;
    const version = policyVersion ?? network.policyVersion;
    if (version <= 0) return undefined;
    try {
      return await this.options.compileAcl(network, device.id, version);
    } catch (error) {
      this.options.logger.warn("failed to compile the network policy", {
        deviceId: device.id,
        policyVersion: version,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async doPush(deviceId: string): Promise<PushResult> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device) return { status: "skipped", reason: "device not found" };
    if (device.state !== "approved") {
      return { status: "skipped", reason: `device is ${device.state}` };
    }
    const client = this.options.sessions.get(deviceId);
    if (!client) return { status: "skipped", reason: "offline" };
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) return { status: "skipped", reason: "network not found" };
    const revisions = await listRevisions(this.options.db, deviceId);
    const latest = revisions[0];
    if (!latest) return { status: "skipped", reason: "no desired config" };

    const instanceId = instanceIdFor(network.id, device.id);
    let config: manage.NetworkConfig;
    try {
      config = await this.desiredConfigFor(
        device,
        network,
        latest.config,
        latest.policyVersion,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure(device, message);
      return { status: "error", reason: message, revision: latest.revision };
    }

    try {
      await client.remote.runNetworkInstance({
        instId: instanceId,
        config,
        overwrite: true,
        source: manage.ConfigSource.ConfigSourceWeb,
        timeoutMs: 20_000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure(device, message);
      await this.options.audit.record({
        orgId: device.orgId,
        actorType: "system",
        action: "device.config.push_failed",
        targetType: "device",
        targetId: device.id,
        metadata: { revision: latest.revision, error: message.slice(0, 500) },
      });
      this.options.logger.warn("config push failed", {
        deviceId,
        revision: latest.revision,
        error: message,
      });
      return { status: "error", reason: message, revision: latest.revision };
    }

    const running = await this.waitForRunning(client, instanceId);
    if (!running.ok) {
      await this.recordFailure(device, running.error);
      await this.options.audit.record({
        orgId: device.orgId,
        actorType: "system",
        action: "device.config.push_failed",
        targetType: "device",
        targetId: device.id,
        metadata: { revision: latest.revision, error: running.error.slice(0, 500) },
      });
      return {
        status: "error",
        reason: running.error,
        revision: latest.revision,
      };
    }

    const now = new Date();
    await updateDevice(this.options.db, device.id, {
      appliedRevision: latest.revision,
      appliedAt: now,
      lastPushAt: now,
      lastPushError: null,
    });
    await this.options.audit.record({
      orgId: device.orgId,
      actorType: "system",
      action: "device.config.pushed",
      targetType: "device",
      targetId: device.id,
      metadata: { revision: latest.revision, instanceId },
    });
    this.options.logger.info("config pushed", {
      deviceId,
      revision: latest.revision,
      instanceId,
    });
    return { status: "pushed", revision: latest.revision };
  }

  private async waitForRunning(
    client: ManagedClient,
    instanceId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const attempts = this.options.pollAttempts ?? 15;
    const interval = this.options.pollIntervalMs ?? 400;
    let lastError = "instance did not report running";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const collected = await client.remote.collectNetworkInfo([instanceId]);
        const info = collected.info?.map[instanceId];
        if (info?.running) return { ok: true };
        if (info?.errorMsg) lastError = info.errorMsg;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (client.isClosed) return { ok: false, error: "client disconnected" };
      await sleep(interval);
    }
    return { ok: false, error: lastError };
  }

  private async recordFailure(device: Device, message: string): Promise<void> {
    await updateDevice(this.options.db, device.id, {
      lastPushError: message.slice(0, 2000),
      lastPushAt: new Date(),
    });
  }

  /**
   * Asks the client what it actually runs and stores it for the routes page:
   * which instances exist, which proxy CIDRs they advertise, whether one is an
   * exit node, and whether an instance is not the one we manage (that one
   * cannot be revoked from here).
   */
  async collectReport(device: Device, client: ManagedClient): Promise<void> {
    if (!this.options.recordReport || client.isClosed) return;
    const last = this.lastReportAt.get(device.id) ?? 0;
    const interval = this.options.reportIntervalMs ?? 30_000;
    if (Date.now() - last < interval) return;
    this.lastReportAt.set(device.id, Date.now());
    try {
      const network = await getNetworkById(this.options.db, device.networkId);
      if (!network) return;
      const managedId = instanceIdFor(network.id, device.id);
      const collected = await client.remote.collectNetworkInfo([]);
      const entries = Object.entries(collected.info?.map ?? {});
      const ids = entries.map(([id]) => id);
      const metas = ids.length > 0
        ? (await client.remote.listNetworkInstanceMeta(ids)).metas
        : [];
      const metaById = new Map(
        metas.map((meta) => [meta.instId ? protoToUuid(meta.instId) : "", meta]),
      );
      let managedExitNode = false;
      if (ids.includes(managedId)) {
        try {
          const config = await client.remote.getNetworkInstanceConfig(managedId);
          managedExitNode = Boolean(config.config?.enableExitNode);
        } catch {
          // The instance may be mid-restart; the CIDR report is still useful.
        }
      }
      const instances: ReportedInstance[] = [];
      for (const [id, info] of entries) {
        const meta = metaById.get(id);
        if (meta && meta.networkName !== network.networkName) continue;
        const own =
          info.routes?.find(
            (route) =>
              route.ipv4Addr?.address?.addr === toIpv4Number(device.virtualIpv4),
          ) ?? info.routes?.[0];
        instances.push({
          instanceId: id,
          networkName: meta?.networkName ?? network.networkName,
          hostname: info.myNodeInfo?.hostname ?? "",
          proxyCidrs: own?.proxyCidrs ?? [],
          exitNode: id === managedId ? managedExitNode : false,
          unmanaged: id !== managedId,
          removable: id === managedId,
        });
      }
      await this.options.recordReport(device, instances);
    } catch (error) {
      this.options.logger.debug("route report failed", {
        deviceId: device.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Periodic convergence check for every online, approved device. */
  async reconcile(): Promise<void> {
    if (this.stopped) return;
    for (const deviceId of this.options.sessions.onlineDeviceIds()) {
      try {
        const result = await this.ensure(deviceId);
        if (result.status !== "skipped") {
          const device = await getDeviceById(this.options.db, deviceId);
          const client = this.options.sessions.get(deviceId);
          if (device && client) await this.collectReport(device, client);
        }
      } catch (error) {
        this.options.logger.debug("reconcile device failed", {
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
