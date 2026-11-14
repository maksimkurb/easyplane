import type { Database } from "../db/client.js";
import {
  deleteDevice,
  findDeviceInNetwork,
  getDevice,
  getNetworkById,
  getRevision,
  incrementInviteUses,
  insertDevice,
  insertRevision,
  listDevices,
  listRevisions,
  listRevisionsWithAuthor,
  pendingDeviceCount,
  touchInvite,
  updateDevice,
  usedVirtualIps,
} from "../db/repositories.js";
import type { Device, DeviceState, Network, UserRole } from "../db/schema.js";
import {
  computeDeviceStatus,
  type DeviceStatus,
} from "../domain/device-status.js";
import { normalizeDesiredConfig, type DesiredConfig } from "../domain/desired-config.js";
import { allocateIpv4, cidrPrefix, parseCidr, parseIpv4 } from "../domain/ip.js";
import { evaluateInvite } from "../domain/invite.js";
import { nextRevisionNumber, planRollback } from "../domain/revisions.js";
import type { ManagedClient } from "../control/managed-client.js";
import type { Logger } from "../logger.js";
import { sha256Hex } from "../security/crypto.js";
import type { AuditService } from "./audit.js";
import type { DeviceSessionRegistry } from "./device-sessions.js";
import { AppError, conflict, invalid, notFound } from "./errors.js";
import type { InviteService } from "./invite-service.js";
import type { PushService } from "./push-service.js";

export interface RequestActor {
  orgId: string;
  userId: string;
  role: UserRole;
}

export interface DeviceDto extends DeviceStatus {
  id: string;
  networkId: string;
  networkName: string;
  machineId: string;
  hostname: string;
  easytierVersion: string;
  os: { type: string; version: string; distribution: string };
  sourceIp: string;
  virtualIpv4: string | null;
  inviteId: string | null;
  desiredRevision: number | null;
  appliedRevision: number | null;
  appliedAt: string | null;
  lastPushAt: string | null;
  lastPushError: string | null;
  lastSeenAt: string | null;
  approvedAt: string | null;
  blockedAt: string | null;
  createdAt: string;
}

export interface RevisionDto {
  id: string;
  deviceId: string;
  revision: number;
  config: Record<string, unknown>;
  note: string;
  source: "approval" | "manual" | "rollback";
  rollbackOfRevision: number | null;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

export interface HeartbeatInput {
  token: string;
  machineId: string;
  hostname: string;
  easytierVersion: string;
  osType: string;
  osVersion: string;
  osDistribution: string;
  sourceIp: string;
  client: ManagedClient;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sliding-window limiter for unauthenticated config-server tokens. */
export class UnknownTokenRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly limitPerMinute: number) {}

  /** Records an attempt; returns false when the caller should be cut off. */
  record(key: string, now = Date.now()): boolean {
    const cutoff = now - 60_000;
    const recent = (this.attempts.get(key) ?? []).filter((at) => at > cutoff);
    recent.push(now);
    if (recent.length > this.limitPerMinute) {
      this.attempts.set(key, recent.slice(-this.limitPerMinute));
      return false;
    }
    this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) {
      for (const [entry, timestamps] of this.attempts) {
        if (timestamps.every((at) => at <= cutoff)) this.attempts.delete(entry);
      }
    }
    return true;
  }
}

export interface DeviceServiceOptions {
  db: Database;
  audit: AuditService;
  invites: InviteService;
  push: PushService;
  sessions: DeviceSessionRegistry;
  logger: Logger;
  onlineTimeoutMs: number;
  maxPendingPerNetwork: number;
  unknownTokenLimitPerMinute: number;
}

export class DeviceService {
  readonly rateLimiter: UnknownTokenRateLimiter;

  constructor(private readonly options: DeviceServiceOptions) {
    this.rateLimiter = new UnknownTokenRateLimiter(
      options.unknownTokenLimitPerMinute,
    );
  }

  private toDto(device: Device, networkName: string, now = new Date()): DeviceDto {
    const status = computeDeviceStatus({
      state: device.state,
      lastSeenAt: device.lastSeenAt,
      now,
      onlineTimeoutMs: this.options.onlineTimeoutMs,
      desiredRevision: device.desiredRevision,
      appliedRevision: device.appliedRevision,
      lastPushError: device.lastPushError,
    });
    return {
      ...status,
      id: device.id,
      networkId: device.networkId,
      networkName,
      machineId: device.machineId,
      hostname: device.hostname,
      easytierVersion: device.easytierVersion,
      os: {
        type: device.osType,
        version: device.osVersion,
        distribution: device.osDistribution,
      },
      sourceIp: device.sourceIp,
      virtualIpv4: device.virtualIpv4,
      inviteId: device.inviteId,
      desiredRevision: device.desiredRevision,
      appliedRevision: device.appliedRevision,
      appliedAt: device.appliedAt?.toISOString() ?? null,
      lastPushAt: device.lastPushAt?.toISOString() ?? null,
      lastPushError: device.lastPushError,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      approvedAt: device.approvedAt?.toISOString() ?? null,
      blockedAt: device.blockedAt?.toISOString() ?? null,
      createdAt: device.createdAt.toISOString(),
    };
  }

  private revisionToDto(revision: {
    id: string;
    deviceId: string;
    revision: number;
    config: Record<string, unknown>;
    note: string;
    source: "approval" | "manual" | "rollback";
    rollbackOfRevision: number | null;
    createdBy: string | null;
    createdAt: Date;
  }, createdByEmail: string | null = null): RevisionDto {
    return {
      id: revision.id,
      deviceId: revision.deviceId,
      revision: revision.revision,
      config: revision.config,
      note: revision.note,
      source: revision.source,
      rollbackOfRevision: revision.rollbackOfRevision,
      createdBy: revision.createdBy,
      createdByEmail,
      createdAt: revision.createdAt.toISOString(),
    };
  }

  /**
   * Resolves the heartbeat token to an invite + device. Unknown tokens are
   * rate-limited by source IP and the session is dropped once over the limit;
   * known tokens never create a second row for the same machine id.
   */
  async handleHeartbeat(input: HeartbeatInput): Promise<{ device: Device; created: boolean }> {
    if (!UUID_RE.test(input.machineId)) {
      throw new AppError(400, "heartbeat has no valid machine_id", "invalid_machine_id");
    }
    const invite = await this.options.invites.resolveToken(input.token);
    if (!invite) {
      const allowed = this.rateLimiter.record(input.sourceIp || "unknown");
      this.options.logger.warn("unknown config-server token", {
        sourceIp: input.sourceIp,
        machineId: input.machineId,
        allowed,
      });
      if (!allowed) {
        input.client.close("too many unknown config-server tokens");
      }
      throw new Error("unknown config-server token");
    }

    const network = await getNetworkById(this.options.db, invite.networkId);
    if (!network) throw new Error("invite network no longer exists");

    const now = new Date();
    const existing = await this.findByMachine(network.id, input.machineId);
    if (existing) {
      if (existing.state === "blocked") {
        input.client.close("device is blocked");
        throw new Error("device is blocked");
      }
      const device = await updateDevice(this.options.db, existing.id, {
        hostname: input.hostname || existing.hostname,
        easytierVersion: input.easytierVersion,
        osType: input.osType,
        osVersion: input.osVersion,
        osDistribution: input.osDistribution,
        sourceIp: input.sourceIp,
        lastSeenAt: now,
      });
      if (!device) throw new Error("failed to update device");
      await touchInvite(this.options.db, invite.id, now);
      this.options.sessions.bind(device.id, input.client);
      if (
        device.state === "approved" &&
        (device.appliedRevision === null ||
          (device.desiredRevision ?? 0) > (device.appliedRevision ?? 0) ||
          (device.lastPushError ?? "") !== "")
      ) {
        this.options.push.schedule(device.id, "heartbeat");
      }
      return { device, created: false };
    }

    const evaluation = evaluateInvite(invite, now);
    if (!evaluation.canCreateDevice) {
      throw new Error(`invite is ${evaluation.rejection}`);
    }
    const pending = await pendingDeviceCount(this.options.db, network.id);
    if (pending >= this.options.maxPendingPerNetwork) {
      throw new Error("pending device limit reached for this network");
    }

    let device: Device;
    try {
      device = await insertDevice(this.options.db, {
        orgId: network.orgId,
        networkId: network.id,
        machineId: input.machineId,
        hostname: input.hostname,
        easytierVersion: input.easytierVersion,
        osType: input.osType,
        osVersion: input.osVersion,
        osDistribution: input.osDistribution,
        sourceIp: input.sourceIp,
        state: "pending",
        inviteId: invite.id,
        lastSeenAt: now,
      });
    } catch (error) {
      // A concurrent heartbeat from the same machine won the race.
      const raced = await this.findByMachine(network.id, input.machineId);
      if (raced) {
        this.options.sessions.bind(raced.id, input.client);
        return { device: raced, created: false };
      }
      throw error;
    }
    await incrementInviteUses(this.options.db, invite.id, now);
    this.options.sessions.bind(device.id, input.client);
    await this.options.audit.record({
      orgId: network.orgId,
      actorType: "device",
      action: "device.joined",
      targetType: "device",
      targetId: device.id,
      metadata: {
        networkId: network.id,
        machineId: device.machineId,
        hostname: device.hostname,
        sourceIp: input.sourceIp,
        inviteId: invite.id,
      },
    });
    this.options.logger.info("device joined as pending", {
      deviceId: device.id,
      machineId: device.machineId,
      networkId: network.id,
    });
    return { device, created: true };
  }

  private async findByMachine(networkId: string, machineId: string) {
    return findDeviceInNetwork(this.options.db, networkId, machineId);
  }

  async list(
    actor: RequestActor,
    filters: { networkId?: string; state?: DeviceState } = {},
  ): Promise<DeviceDto[]> {
    const devices = await listDevices(this.options.db, actor.orgId, filters);
    const names = new Map<string, string>();
    for (const device of devices) {
      if (!names.has(device.networkId)) {
        const network = await getNetworkById(this.options.db, device.networkId);
        names.set(device.networkId, network?.name ?? "");
      }
    }
    return devices.map((device) =>
      this.toDto(device, names.get(device.networkId) ?? ""),
    );
  }

  async get(actor: RequestActor, deviceId: string): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    return this.toDto(device, network?.name ?? "");
  }

  async listRevisions(actor: RequestActor, deviceId: string): Promise<RevisionDto[]> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const revisions = await listRevisionsWithAuthor(this.options.db, deviceId);
    return revisions.map((row) =>
      this.revisionToDto(row.revision, row.createdByEmail),
    );
  }

  private validateAddress(
    network: Network,
    address: string,
    used: Iterable<string>,
    ignore?: string | null,
  ): string {
    const cidr = parseCidr(network.ipv4Cidr);
    const value = parseIpv4(address);
    const first = (cidr.base + 1) >>> 0;
    const last = (cidr.base + cidr.size - 2) >>> 0;
    if (value < first || value > last) {
      invalid(`address ${address} is outside ${network.ipv4Cidr}`);
    }
    for (const existing of used) {
      if (existing !== ignore && existing === address) {
        conflict(`address ${address} is already allocated in this network`);
      }
    }
    return address;
  }

  async approve(
    actor: RequestActor,
    deviceId: string,
    request: { virtualIpv4?: string } = {},
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");

    const used = await usedVirtualIps(this.options.db, network.id);
    const address = request.virtualIpv4
      ? this.validateAddress(network, request.virtualIpv4, used, device.virtualIpv4)
      : device.virtualIpv4 ??
        allocateIpv4(network.ipv4Cidr, used) ??
        (() => {
          throw new AppError(
            409,
            `no free address left in ${network.ipv4Cidr}`,
            "address_pool_exhausted",
          );
        })();

    const revisions = await listRevisions(this.options.db, deviceId);
    let desiredRevision = device.desiredRevision;
    if (revisions.length === 0) {
      const defaults: Partial<DesiredConfig> = {
        networkLength: cidrPrefix(network.ipv4Cidr),
      };
      const config = normalizeDesiredConfig(network.defaultConfig, defaults);
      const revision = await insertRevision(this.options.db, {
        orgId: actor.orgId,
        networkId: network.id,
        deviceId,
        revision: 1,
        config,
        note: "initial config on approval",
        source: "approval",
        createdBy: actor.userId,
      });
      desiredRevision = revision.revision;
    }

    const now = new Date();
    const updated = await updateDevice(this.options.db, deviceId, {
      state: "approved",
      virtualIpv4: address,
      approvedAt: now,
      approvedBy: actor.userId,
      blockedAt: null,
      blockedBy: null,
      desiredRevision,
    });
    if (!updated) throw new AppError(500, "failed to approve device");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.approved",
      targetType: "device",
      targetId: deviceId,
      metadata: {
        networkId: network.id,
        virtualIpv4: address,
        desiredRevision,
      },
    });
    this.options.push.schedule(deviceId, "approved");
    return this.toDto(updated, network.name);
  }

  async block(actor: RequestActor, deviceId: string): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const now = new Date();
    const updated = await updateDevice(this.options.db, deviceId, {
      state: "blocked",
      blockedAt: now,
      blockedBy: actor.userId,
    });
    if (!updated) throw new AppError(500, "failed to block device");
    this.options.sessions.get(deviceId)?.close("device was blocked");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.blocked",
      targetType: "device",
      targetId: deviceId,
      metadata: { networkId: device.networkId, hostname: device.hostname },
    });
    const network = await getNetworkById(this.options.db, device.networkId);
    return this.toDto(updated, network?.name ?? "");
  }

  async remove(actor: RequestActor, deviceId: string): Promise<void> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    this.options.sessions.get(deviceId)?.close("device was deleted");
    await deleteDevice(this.options.db, deviceId);
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.deleted",
      targetType: "device",
      targetId: deviceId,
      metadata: {
        networkId: device.networkId,
        machineId: device.machineId,
        hostname: device.hostname,
      },
    });
  }

  /** Manual push ("retry now"). */
  async push(actor: RequestActor, deviceId: string): Promise<{ status: string; revision?: number; reason?: string }> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.push_requested",
      targetType: "device",
      targetId: deviceId,
    });
    return this.options.push.ensure(deviceId);
  }

  async createRevision(
    actor: RequestActor,
    deviceId: string,
    input: { config: Record<string, unknown>; note?: string },
  ): Promise<{ revision: RevisionDto; device: DeviceDto }> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");

    let config: DesiredConfig;
    try {
      config = normalizeDesiredConfig(input.config, {
        hostname: device.hostname || undefined,
        networkLength: cidrPrefix(network.ipv4Cidr),
      });
    } catch (error) {
      invalid(error instanceof Error ? error.message : "invalid config");
    }

    if (config.virtualIpv4) {
      const used = await usedVirtualIps(this.options.db, network.id);
      this.validateAddress(network, config.virtualIpv4, used, device.virtualIpv4);
    }

    const revisions = await listRevisions(this.options.db, deviceId);
    const revisionNumber = nextRevisionNumber(
      revisions.map((revision) => ({
        revision: revision.revision,
        config: revision.config,
      })),
    );
    const revision = await insertRevision(this.options.db, {
      orgId: actor.orgId,
      networkId: network.id,
      deviceId,
      revision: revisionNumber,
      config,
      note: input.note ?? "",
      source: "manual",
      createdBy: actor.userId,
    });
    const updated = await updateDevice(this.options.db, deviceId, {
      desiredRevision: revision.revision,
      ...(config.virtualIpv4 ? { virtualIpv4: config.virtualIpv4 } : {}),
    });
    if (!updated) throw new AppError(500, "failed to update device");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.config.revision_created",
      targetType: "device",
      targetId: deviceId,
      metadata: {
        revision: revision.revision,
        note: revision.note,
        virtualIpv4: config.virtualIpv4 ?? null,
      },
    });
    this.options.push.schedule(deviceId, "revision created");
    return {
      revision: this.revisionToDto(revision),
      device: this.toDto(updated, network.name),
    };
  }

  async rollback(
    actor: RequestActor,
    deviceId: string,
    targetRevision: number,
  ): Promise<{ revision: RevisionDto; device: DeviceDto }> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    const target = await getRevision(this.options.db, deviceId, targetRevision);
    if (!target) notFound(`revision ${targetRevision} not found`);

    const revisions = await listRevisions(this.options.db, deviceId);
    const plan = planRollback(
      revisions.map((revision) => ({
        revision: revision.revision,
        config: revision.config,
      })),
      targetRevision,
    );
    const config = normalizeDesiredConfig(plan.config);
    if (config.virtualIpv4 && config.virtualIpv4 !== device.virtualIpv4) {
      const used = await usedVirtualIps(this.options.db, network.id);
      this.validateAddress(network, config.virtualIpv4, used, device.virtualIpv4);
    }
    const revision = await insertRevision(this.options.db, {
      orgId: actor.orgId,
      networkId: network.id,
      deviceId,
      revision: plan.revision,
      config,
      note: `rollback to revision ${targetRevision}`,
      source: "rollback",
      rollbackOfRevision: plan.rollbackOfRevision,
      createdBy: actor.userId,
    });
    const updated = await updateDevice(this.options.db, deviceId, {
      desiredRevision: revision.revision,
      ...(config.virtualIpv4 ? { virtualIpv4: config.virtualIpv4 } : {}),
    });
    if (!updated) throw new AppError(500, "failed to update device");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.config.rollback",
      targetType: "device",
      targetId: deviceId,
      metadata: { revision: revision.revision, rollbackOf: targetRevision },
    });
    this.options.push.schedule(deviceId, "rollback");
    return {
      revision: this.revisionToDto(revision),
      device: this.toDto(updated, network.name),
    };
  }

  /**
   * Called on config-server session close: only bookkeeping. The online flag is
   * derived from lastSeenAt, so no DB write is needed here; keeping the hook
   * makes the lifecycle explicit and lets tests observe it.
   */
  handleSessionClosed(client: ManagedClient): void {
    this.options.sessions.unbindClient(client);
  }

  /** Hash helper kept here so tests can assert token storage without a DB. */
  static hashToken(token: string): string {
    return sha256Hex(token);
  }
}
