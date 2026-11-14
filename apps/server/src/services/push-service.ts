import { manage } from "@easyplane/proto";

import type { ManagedClient } from "../control/managed-client.js";
import type { DbExecutor } from "../db/repositories.js";
import {
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export function instanceIdFor(networkId: string, deviceId: string): string {
  return deterministicUuid("easyplane.network-instance", networkId, deviceId);
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
            const desired = this.buildConfig(device, network, latest.config);
            if (configMatchesDesired(reported.config, desired)) {
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

  private buildConfig(
    device: Device,
    network: Network,
    rawConfig: Record<string, unknown>,
  ): manage.NetworkConfig {
    const stored = normalizeDesiredConfig(rawConfig);
    return buildNetworkConfig({
      networkId: network.id,
      deviceId: device.id,
      instanceId: instanceIdFor(network.id, device.id),
      deviceHostname: device.hostname || "easyplane-device",
      networkName: network.networkName,
      networkSecret: this.options.secretBox.decrypt(network.secretCiphertext),
      stored,
      assignedIpv4: device.virtualIpv4,
      ipv4Cidr: network.ipv4Cidr,
    });
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
      config = this.buildConfig(device, network, latest.config);
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

  /** Periodic convergence check for every online, approved device. */
  async reconcile(): Promise<void> {
    if (this.stopped) return;
    for (const deviceId of this.options.sessions.onlineDeviceIds()) {
      try {
        await this.ensure(deviceId);
      } catch (error) {
        this.options.logger.debug("reconcile device failed", {
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
