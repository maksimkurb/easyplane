import type { Database } from "../db/client.js";
import {
  compactNetworkPeerPositions,
  deleteDevice,
  deleteDeviceBackedPeers,
  findDeviceBackedPeer,
  findDeviceByDnsName,
  findDeviceInNetwork,
  findUserById,
  getCredentialByDevice,
  getDevice,
  getDeviceById,
  getNetworkById,
  getRevision,
  incrementInviteUses,
  insertDevice,
  insertNetworkPeer,
  insertRevision,
  listApprovedDevicesByRole,
  listApprovedDevicesInNetwork,
  listCredentialsForOrg,
  listDeviceRoutes,
  listDeviceTags,
  listDevices,
  listOrgDeviceRoutes,
  listOrgWireguardClients,
  listRevisions,
  listRevisionsWithAuthor,
  listTags,
  countWireguardClientsForHub,
  nextNetworkPeerPosition,
  pendingDeviceCount,
  setDeviceTags,
  takenDnsNames,
  touchInvite,
  updateDevice,
  usedVirtualIps,
} from "../db/repositories.js";
import type {
  Credential,
  Device,
  DeviceRoute,
  DeviceState,
  Network,
  UserRole,
} from "../db/schema.js";
import {
  computeDeviceStatus,
  type DeviceStatus,
  type OnlineState,
} from "../domain/device-status.js";
import {
  DEVICE_DESCRIPTION_MAX_LENGTH,
  isDeviceDescriptionLengthValid,
  normalizeDeviceDescription,
} from "../domain/device-description.js";
import { effectiveRole, knowsNetworkSecret } from "../domain/credentials.js";
import { isValidHubPort } from "../domain/hub.js";
import {
  isConfigReadOnly,
  normalizeDesiredConfig,
  type DesiredConfig,
} from "../domain/desired-config.js";
import { allocateIpv4, cidrPrefix, parseCidr, parseIpv4 } from "../domain/ip.js";
import { evaluateInvite } from "../domain/invite.js";
import {
  DEFAULT_MAGIC_DNS_ZONE,
  allocateDnsLabel,
  isValidDnsLabel,
  normalizeDnsZone,
  toDnsLabel,
} from "../domain/magic-dns.js";
import { nextRevisionNumber, planRollback } from "../domain/revisions.js";
import { dedupePeerUrls } from "../domain/peers.js";
import { readDriftState } from "../domain/drift.js";
import {
  readPortalApplyError,
  readPortalSnapshot,
  portalModeForDevice,
} from "../domain/wireguard.js";
import type { ManagedClient } from "../control/managed-client.js";
import type { Logger } from "../logger.js";
import type { DeviceChangedField } from "../realtime/events.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { sha256Hex } from "../security/crypto.js";
import type { AuditService } from "./audit.js";
import type { DeviceSessionRegistry } from "./device-sessions.js";
import { AppError, conflict, invalid, notFound } from "./errors.js";
import {
  credentialToDto,
  type CredentialService,
  type CredentialDto,
} from "./credential-service.js";
import type { InviteService } from "./invite-service.js";
import { instanceIdFor, type PushService } from "./push-service.js";

export interface RequestActor {
  orgId: string;
  userId: string;
  role: UserRole;
}

/** Optional hub settings saved together with the hub flag. */
export interface HubUpdateSettings {
  listenPort?: number | null;
  externalPort?: number | null;
  endpoints?: readonly string[];
}

export interface DeviceDto extends DeviceStatus {
  id: string;
  networkId: string;
  networkName: string;
  machineId: string;
  /** Hostname the client reports (informational). */
  hostname: string;
  /** Unique DNS name inside the network; authoritative for pushes/MagicDNS. */
  dnsName: string | null;
  /** `<dnsName>.<network zone>` when MagicDNS can resolve the device. */
  magicDnsName: string | null;
  magicDnsZone: string;
  magicDnsEnabled: boolean;
  easytierVersion: string;
  os: { type: string; version: string; distribution: string };
  sourceIp: string;
  virtualIpv4: string | null;
  inviteId: string | null;
  ownerUserId: string | null;
  /** Short human note about the device ("Роутер в гараже"); null when unset. */
  description: string | null;
  /** Peer URLs other devices dial to reach this one. */
  advertisedEndpoints: string[];
  /** Port EasyTier binds for a hub (null = default 11010). */
  listenPort: number | null;
  /** Port peers dial (null = same as the listen port). */
  externalPort: number | null;
  /** Last public IPv4 addresses observed for this device. */
  publicIps: string[];
  /** `true` when this device is a hub in its network's peer list. */
  isHub: boolean;
  /** UDP port of this hub's WireGuard portal (null = portal disabled). */
  wgListenPort: number | null;
  /** Number of WireGuard portal clients served by this hub. */
  wireguardClientCount: number;
  /**
   * Portal generation of a hub: `per-client` (EasyTier >= 2.7.0), `legacy`
   * (2.6.x, one shared config) or `unknown`.
   */
  wgPortalMode: "per-client" | "legacy" | "unknown";
  /** Last known portal state (disabled/starting/running/unsupported/error). */
  wgPortalState: "disabled" | "starting" | "running" | "unsupported" | "error";
  /** Plain-language portal problem, or null. */
  wgPortalError: string | null;
  /** Legacy (< 2.7.0) portal pool (`client_cidr`), when configured. */
  wgLegacyClientCidr: string | null;
  /** Why the client still reports a config different from the desired one. */
  driftReason: string | null;
  /** Consecutive non-converging pushes (exponential backoff counter). */
  driftAttempts: number;
  /** No repush before this time; null when there is no active drift. */
  driftRetryAt: string | null;
  /** Stored role: anchor or member (docs/CREDENTIALS.md). */
  role: "anchor" | "member";
  /** Role in effect: always `anchor` in shared-secret mode. */
  effectiveRole: "anchor" | "member";
  /** Whether the device holds the network secret (cannot be safely revoked). */
  knowsSecret: boolean;
  /** Access mode of the network this device belongs to. */
  accessMode: "shared_secret" | "credentials";
  /** Per-device credential in credentials mode; never contains the secret. */
  credential: CredentialDto | null;
  tags: string[];
  /**
   * Exit-node status for badges: `approved` when an approved exit-node route
   * exists, `proposed` when the device advertises one that is still pending.
   */
  exitNode: "none" | "proposed" | "approved";
  /**
   * True when the client's instance file is read-only (external `-c`): the
   * panel cannot read or overwrite its config (docs/POLICY.md §7.1).
   */
  configManagedLocally: boolean;
  /** Last route report (proxy CIDRs / unmanaged instances), if any. */
  reportedState: Record<string, unknown>;
  reportedStateAt: string | null;
  desiredRevision: number | null;
  appliedRevision: number | null;
  policyVersion: number;
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
  source: "approval" | "manual" | "rollback" | "policy";
  policyVersion: number | null;
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
  /** Live browser fan-out; optional so unit tests can omit it. */
  realtime?: RealtimeHub;
  onlineTimeoutMs: number;
  maxPendingPerNetwork: number;
  unknownTokenLimitPerMinute: number;
  /**
   * How often a heartbeat rewrites `devices.last_seen_at` (and identity
   * fields). The client sends 1/s; persisting every one of those is a write
   * amplification that hurts at a few hundred devices. Status is still
   * in-memory/live over SSE and the online timeout is well above this.
   */
  heartbeatPersistIntervalMs?: number;
  /** Fallback lookup by machine id for reconnects that raced the registry. */
  listClients?: () => ManagedClient[];
  /** Credential lifecycle (credentials networks); optional in unit tests. */
  credentials?: CredentialService;
}

/**
 * Badge state for exit nodes. "Proposed" means the device advertises the flag
 * in its own config and no admin has decided yet; a rejected declaration does
 * not count (the UI shows it on the routes card instead).
 */
function exitNodeStateFor(
  routes: readonly DeviceRoute[],
  deviceId: string,
): "none" | "proposed" | "approved" {
  let proposed = false;
  for (const route of routes) {
    if (route.deviceId !== deviceId) continue;
    if (route.kind !== "exit_node" || route.state === "rejected") continue;
    if (route.state === "approved") return "approved";
    if (route.source === "device_declared") proposed = true;
  }
  return proposed ? "proposed" : "none";
}

/**
 * Status projection compared between events. `lastSeenAt` participates in
 * `changed` (the client patches it) but deliberately not in `signature`: a
 * heartbeat that only refreshes it must not publish anything.
 */
interface DeviceEventFields {
  state: "pending" | "approved" | "blocked";
  online: OnlineState;
  sync: DeviceStatus["sync"];
  hostname: string;
  virtualIpv4: string | null;
  lastSeenAt: string | null;
  desiredRevision: number | null;
  appliedRevision: number | null;
  appliedAt: string | null;
  lastPushAt: string | null;
  lastPushError: string | null;
}

export class DeviceService {
  readonly rateLimiter: UnknownTokenRateLimiter;
  /**
   * Last published status per device. Heartbeats arrive every second; only a
   * real signature change is published, so an idle panel sees no traffic.
   * `fields` is kept to report `changed` to the client for in-place patching.
   */
  private readonly lastEvent = new Map<
    string,
    { signature: string; fields: DeviceEventFields }
  >();
  /**
   * Per-network approval queue. Address and MagicDNS-name allocation are
   * read-then-write against unique indexes; two concurrent approvals would
   * otherwise pick the same free value and one would fail. (Single process, as
   * documented for replication.)
   */
  private readonly networkLocks = new Map<string, Promise<unknown>>();
  /**
   * `invites.last_used_at` is telemetry, not state. Writing it on every 1 s
   * heartbeat serialises a whole fleet on one row (the load test found this at
   * 200 clients); touching it once a minute is enough.
   */
  private readonly lastInviteTouch = new Map<string, number>();

  constructor(private readonly options: DeviceServiceOptions) {
    this.rateLimiter = new UnknownTokenRateLimiter(
      options.unknownTokenLimitPerMinute,
    );
  }

  /**
   * Publishes a `device.updated` event for an explicit change (approval,
   * rename, push result, …). Heartbeats are special: they arrive every second,
   * so `reason === "heartbeat"` publishes only when the status signature
   * really changed. Pure `lastSeenAt` refreshes never publish — the panel no
   * longer needs a heartbeat to keep "last seen" moving, which is what turns
   * an idle network page into zero requests (docs/REALTIME.md §3).
   */
  async notifyDevice(
    deviceId: string,
    reason: string,
    options: { online?: OnlineState } = {},
  ): Promise<boolean> {
    if (!this.options.realtime) return false;
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device) return false;
    return this.publishDevice(device, reason, options);
  }

  /** Same as `notifyDevice` for a device row the caller already holds. */
  publishDevice(
    device: Device,
    reason: string,
    options: { online?: OnlineState } = {},
  ): boolean {
    const realtime = this.options.realtime;
    if (!realtime) return false;
    const status = computeDeviceStatus({
      state: device.state,
      lastSeenAt: device.lastSeenAt,
      now: new Date(),
      onlineTimeoutMs: this.options.onlineTimeoutMs,
      desiredRevision: device.desiredRevision,
      appliedRevision: device.appliedRevision,
      lastPushError: device.lastPushError,
    });
    const fields: DeviceEventFields = {
      state: device.state,
      online: options.online ?? status.online,
      sync: status.sync,
      hostname: device.dnsName ?? device.hostname,
      virtualIpv4: device.virtualIpv4,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      desiredRevision: device.desiredRevision,
      appliedRevision: device.appliedRevision,
      appliedAt: device.appliedAt?.toISOString() ?? null,
      lastPushAt: device.lastPushAt?.toISOString() ?? null,
      lastPushError: device.lastPushError,
    };
    // Everything except lastSeenAt: a heartbeat that only touches it is a
    // no-op for the panel.
    const signature = JSON.stringify([
      fields.state,
      fields.online,
      fields.sync,
      fields.hostname,
      fields.virtualIpv4,
      fields.desiredRevision,
      fields.appliedRevision,
      fields.appliedAt,
      fields.lastPushAt,
      fields.lastPushError,
    ]);
    const previous = this.lastEvent.get(device.id);
    const isHeartbeat = reason === "heartbeat";
    if (isHeartbeat && previous?.signature === signature) return false;
    const changed = previous
      ? (Object.keys(fields) as Array<keyof DeviceEventFields>).filter(
          (field) => previous.fields[field] !== fields[field],
        )
      : [];
    this.lastEvent.set(device.id, { signature, fields });
    realtime.publish({
      type: "device.updated",
      orgId: device.orgId,
      networkId: device.networkId,
      deviceId: device.id,
      data: {
        deviceId: device.id,
        networkId: device.networkId,
        state: fields.state,
        online: fields.online,
        sync: fields.sync,
        hostname: fields.hostname,
        virtualIpv4: fields.virtualIpv4,
        lastSeenAt: fields.lastSeenAt,
        desiredRevision: fields.desiredRevision,
        appliedRevision: fields.appliedRevision,
        appliedAt: fields.appliedAt,
        lastPushAt: fields.lastPushAt,
        lastPushError: fields.lastPushError,
        reason,
        changed: changed as DeviceChangedField[],
      },
    });
    // Keep the cache small on a long-lived process.
    if (this.lastEvent.size > 10_000) this.lastEvent.clear();
    return true;
  }

  /** Publishes `device.removed` before the row disappears. */
  private notifyRemoved(device: Device): void {
    this.options.realtime?.publish({
      type: "device.removed",
      orgId: device.orgId,
      networkId: device.networkId,
      deviceId: device.id,
      data: { deviceId: device.id, networkId: device.networkId },
    });
    this.lastEvent.delete(device.id);
  }

  private async tagsByDevice(orgId: string, deviceId?: string): Promise<Map<string, string[]>> {
    const rows = await listDeviceTags(this.options.db, orgId);
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (deviceId && row.deviceId !== deviceId) continue;
      const list = map.get(row.deviceId) ?? [];
      list.push(row.tagName);
      map.set(row.deviceId, list);
    }
    for (const list of map.values()) list.sort();
    return map;
  }

  /** Loads the credential row and builds the DTO (the only async wrapper). */
  private async dto(
    device: Device,
    network: Network | undefined,
    tags: string[] = [],
    credential?: Credential | null,
  ): Promise<DeviceDto> {
    const row =
      credential === undefined
        ? await getCredentialByDevice(this.options.db, device.id)
        : credential;
    const [routes, wireguardClientCount] = await Promise.all([
      listDeviceRoutes(this.options.db, device.id),
      countWireguardClientsForHub(this.options.db, device.id),
    ]);
    return this.toDto(
      device,
      network,
      tags,
      row ?? null,
      new Date(),
      exitNodeStateFor(routes, device.id),
      wireguardClientCount,
    );
  }

  private toDto(
    device: Device,
    network: Network | undefined,
    tags: string[] = [],
    credential: Credential | null = null,
    now = new Date(),
    exitNode: "none" | "proposed" | "approved" = "none",
    wireguardClientCount = 0,
  ): DeviceDto {
    const drift = readDriftState(device.reportedState);
    const status = computeDeviceStatus({
      state: device.state,
      lastSeenAt: device.lastSeenAt,
      now,
      onlineTimeoutMs: this.options.onlineTimeoutMs,
      desiredRevision: device.desiredRevision,
      appliedRevision: device.appliedRevision,
      lastPushError: device.lastPushError,
      driftPending: drift !== null,
    });
    const portalMode = device.isHub ? portalModeForDevice(device) : "unknown";
    const portalSnapshot = readPortalSnapshot(device.reportedState);
    const portalApplyError = readPortalApplyError(device.reportedState);
    const portalUnsupported = portalSnapshot?.state === "unsupported";
    const portalState =
      device.wgListenPort === null
        ? ("disabled" as const)
        : portalUnsupported
          ? ("unsupported" as const)
          : portalApplyError
            ? ("error" as const)
            : (portalSnapshot?.state ?? ("starting" as const));
    const portalError = portalUnsupported
      ? (portalSnapshot?.error ?? null)
      : (portalApplyError?.message ?? portalSnapshot?.error ?? null);
    const zone = network?.magicDnsZone ?? DEFAULT_MAGIC_DNS_ZONE;
    const magicDnsEnabled = network?.magicDnsEnabled ?? false;
    const accessMode = network?.accessMode ?? "shared_secret";
    const role = effectiveRole(accessMode, device.role);
    return {
      ...status,
      id: device.id,
      networkId: device.networkId,
      networkName: network?.name ?? "",
      machineId: device.machineId,
      hostname: device.hostname,
      dnsName: device.dnsName,
      magicDnsName:
        device.dnsName && magicDnsEnabled ? `${device.dnsName}.${zone}` : null,
      magicDnsZone: zone,
      magicDnsEnabled,
      easytierVersion: device.easytierVersion,
      os: {
        type: device.osType,
        version: device.osVersion,
        distribution: device.osDistribution,
      },
      sourceIp: device.sourceIp,
      virtualIpv4: device.virtualIpv4,
      inviteId: device.inviteId,
      ownerUserId: device.ownerUserId,
      description: device.description,
      advertisedEndpoints: device.advertisedEndpoints,
      listenPort: device.listenPort,
      externalPort: device.externalPort,
      publicIps: device.publicIps,
      isHub: device.isHub,
      wgListenPort: device.wgListenPort,
      wireguardClientCount,
      wgPortalMode: portalMode,
      wgPortalState: portalState,
      wgPortalError: portalError,
      wgLegacyClientCidr: device.wgLegacyClientCidr,
      driftReason: drift?.reason ?? null,
      driftAttempts: drift?.attempts ?? 0,
      driftRetryAt: drift?.nextRetryAt ?? null,
      role: device.role,
      effectiveRole: role,
      knowsSecret: knowsNetworkSecret(accessMode, device.role),
      accessMode,
      credential: credential ? credentialToDto(credential, now) : null,
      tags,
      exitNode,
      configManagedLocally: isConfigReadOnly(device.reportedState),
      reportedState: device.reportedState,
      reportedStateAt: device.reportedStateAt?.toISOString() ?? null,
      desiredRevision: device.desiredRevision,
      appliedRevision: device.appliedRevision,
      policyVersion: network?.policyVersion ?? 0,
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
    source: "approval" | "manual" | "rollback" | "policy";
    policyVersion: number | null;
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
      policyVersion: revision.policyVersion,
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
      const identityChanged =
        existing.hostname !== (input.hostname || existing.hostname) ||
        existing.easytierVersion !== input.easytierVersion ||
        existing.osType !== input.osType ||
        existing.osVersion !== input.osVersion ||
        existing.osDistribution !== input.osDistribution ||
        existing.sourceIp !== input.sourceIp;
      const persistIntervalMs = Math.max(
        250,
        this.options.heartbeatPersistIntervalMs ?? 2_000,
      );
      const lastSeenDue =
        existing.lastSeenAt === null ||
        now.getTime() - existing.lastSeenAt.getTime() >= persistIntervalMs;
      let device = existing;
      if (identityChanged || lastSeenDue) {
        const updated = await updateDevice(this.options.db, existing.id, {
          hostname: input.hostname || existing.hostname,
          easytierVersion: input.easytierVersion,
          osType: input.osType,
          osVersion: input.osVersion,
          osDistribution: input.osDistribution,
          sourceIp: input.sourceIp,
          lastSeenAt: now,
        });
        if (!updated) throw new Error("failed to update device");
        device = updated;
      }
      const lastTouch = this.lastInviteTouch.get(invite.id) ?? 0;
      if (now.getTime() - lastTouch >= 60_000) {
        this.lastInviteTouch.set(invite.id, now.getTime());
        if (this.lastInviteTouch.size > 10_000) this.lastInviteTouch.clear();
        await touchInvite(this.options.db, invite.id, now);
      }
      this.options.sessions.bind(device.id, input.client);
      if (
        device.state === "approved" &&
        (device.appliedRevision === null ||
          (device.desiredRevision ?? 0) > (device.appliedRevision ?? 0) ||
          (device.lastPushError ?? "") !== "")
      ) {
        this.options.push.schedule(device.id, "heartbeat");
      }
      this.publishDevice(device, "heartbeat");
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
        role: invite.role,
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
    this.publishDevice(device, "joined");
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
    const networks = new Map<string, Network>();
    for (const device of devices) {
      if (!networks.has(device.networkId)) {
        const network = await getNetworkById(this.options.db, device.networkId);
        if (network) networks.set(device.networkId, network);
      }
    }
    const tags = await this.tagsByDevice(actor.orgId);
    const credentials = new Map<string, Credential>(
      (await listCredentialsForOrg(this.options.db, actor.orgId)).map((row) => [
        row.deviceId,
        row,
      ]),
    );
    const orgRoutes = new Map<string, DeviceRoute[]>();
    const routes = await listOrgDeviceRoutes(this.options.db, actor.orgId);
    for (const route of routes) {
      const list = orgRoutes.get(route.deviceId) ?? [];
      list.push(route);
      orgRoutes.set(route.deviceId, list);
    }
    const wireguardCounts = new Map<string, number>();
    for (const client of await listOrgWireguardClients(this.options.db, actor.orgId)) {
      wireguardCounts.set(
        client.hubDeviceId,
        (wireguardCounts.get(client.hubDeviceId) ?? 0) + 1,
      );
    }
    return devices.map((device) =>
      this.toDto(
        device,
        networks.get(device.networkId),
        tags.get(device.id) ?? [],
        credentials.get(device.id) ?? null,
        new Date(),
        exitNodeStateFor(orgRoutes.get(device.id) ?? [], device.id),
        wireguardCounts.get(device.id) ?? 0,
      ),
    );
  }

  async get(actor: RequestActor, deviceId: string): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return this.dto(device, network, tags.get(deviceId) ?? []);
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

  /**
   * Picks the DNS name for a device: the sanitised client hostname when free,
   * otherwise `name-2`, `name-3`... The name is unique per network
   * (case-insensitive) and enforced by a unique index as well.
   */
  private async allocateDnsName(
    networkId: string,
    requested: string,
    ignoreDeviceId?: string,
  ): Promise<string> {
    const taken = await takenDnsNames(this.options.db, networkId, ignoreDeviceId);
    return allocateDnsLabel(requested, taken);
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

    return this.withNetworkLock(network.id, async () => {
      const current = (await getDevice(this.options.db, actor.orgId, deviceId)) ?? device;
      return this.approveLocked(actor, current, network, request);
    });
  }

  private async withNetworkLock<T>(
    networkId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.networkLocks.get(networkId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    this.networkLocks.set(networkId, tail);
    try {
      return await run;
    } finally {
      if (this.networkLocks.get(networkId) === tail) {
        this.networkLocks.delete(networkId);
      }
    }
  }

  private async approveLocked(
    actor: RequestActor,
    device: Device,
    network: Network,
    request: { virtualIpv4?: string },
  ): Promise<DeviceDto> {
    const credentialMode = network.accessMode === "credentials";
    if (credentialMode && device.role === "member") {
      const anchors = await listApprovedDevicesByRole(
        this.options.db,
        network.id,
        "anchor",
      );
      if (anchors.length === 0) {
        // Enforced here because this is the moment access is granted: a
        // credentials network without an anchor has no trust root, so a
        // member would never be admitted.
        conflict(
          "the first device of a credentials network must be an anchor " +
            "(a device that holds the network secret). Approve an anchor first, " +
            "or change the role of the invite/device.",
        );
      }
    }
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

    let dnsName = device.dnsName;
    if (!dnsName) {
      dnsName = await this.allocateDnsName(
        network.id,
        device.hostname || device.machineId.slice(0, 8),
        device.id,
      );
    }

    const revisions = await listRevisions(this.options.db, device.id);
    let desiredRevision = device.desiredRevision;
    if (revisions.length === 0) {
      const defaults: Partial<DesiredConfig> = {
        networkLength: cidrPrefix(network.ipv4Cidr),
      };
      const config = normalizeDesiredConfig(network.defaultConfig, defaults);
      const revision = await insertRevision(this.options.db, {
        orgId: actor.orgId,
        networkId: network.id,
        deviceId: device.id,
        revision: 1,
        config,
        note: "initial config on approval",
        source: "approval",
        policyVersion: network.policyVersion,
        createdBy: actor.userId,
      });
      desiredRevision = revision.revision;
    }

    const now = new Date();
    const updated = await updateDevice(this.options.db, device.id, {
      state: "approved",
      virtualIpv4: address,
      dnsName,
      ownerUserId: device.ownerUserId ?? actor.userId,
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
      targetId: device.id,
      metadata: {
        networkId: network.id,
        virtualIpv4: address,
        dnsName,
        desiredRevision,
      },
    });
    this.options.push.schedule(device.id, "approved");
    if (credentialMode && updated.role === "member") {
      // Members join with a per-device key; anchors get it in the next push.
      await this.options.credentials?.issueForDevice({
        network,
        device: updated,
        userId: actor.userId,
        reason: "device approved",
        tags: (await this.tagsByDevice(actor.orgId, device.id)).get(device.id) ?? [],
      });
    }
    // Other devices must stop dialling this one if it is blocked later, and
    // must receive a newly approved hub's endpoints.
    await this.repushNetwork(network.id, "device approved");
    this.publishDevice(updated, "approved");
    const tags = await this.tagsByDevice(actor.orgId, device.id);
    return this.dto(updated, network, tags.get(device.id) ?? []);
  }

  /**
   * Stops the EasyTier instance on a connected device before dropping its
   * session. Blocking is enforced by refusing heartbeats; deleting the instance
   * also stops the running network instead of leaving it up until restart.
   */
  /**
   * Finds the live session for a device. The registry is authoritative, but a
   * reconnect can briefly race the heartbeat that binds it; the control plane's
   * session list still knows the machine id.
   */
  private findClient(device: Device): ManagedClient | undefined {
    const bound = this.options.sessions.get(device.id);
    if (bound) return bound;
    return this.options
      .listClients?.()
      .find(
        (client) =>
          !client.isClosed &&
          client.latestHeartbeat?.machineId === device.machineId,
      );
  }

  private async stopInstance(
    client: ManagedClient,
    device: Device,
  ): Promise<"deleted" | "failed" | "offline"> {
    if (client.isClosed) return "offline";
    try {
      await client.remote.deleteNetworkInstance([
        instanceIdFor(device.networkId, device.id),
      ]);
      return "deleted";
    } catch (error) {
      this.options.logger.warn("failed to delete the device network instance", {
        deviceId: device.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
  }

  async block(
    actor: RequestActor,
    deviceId: string,
    options: { acknowledgeAnchorRisk?: boolean } = {},
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    this.assertAnchorRemoval(network, device, "block", options);
    const client = this.findClient(device);
    const instanceCleanup = client
      ? await this.stopInstance(client, device)
      : "offline";
    const now = new Date();
    const updated = await updateDevice(this.options.db, deviceId, {
      state: "blocked",
      blockedAt: now,
      blockedBy: actor.userId,
    });
    if (!updated) throw new AppError(500, "failed to block device");
    client?.close("device was blocked");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.blocked",
      targetType: "device",
      targetId: deviceId,
      metadata: {
        networkId: device.networkId,
        hostname: device.hostname,
        instanceStopped: instanceCleanup === "deleted",
        instanceCleanup,
        ...(network.accessMode === "credentials" && device.role === "anchor"
          ? { anchorRemovalAcknowledged: true }
          : {}),
      },
    });
    if (network.accessMode === "credentials" && device.role === "anchor") {
      await this.options.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: "device.anchor_removed_acknowledged",
        targetType: "device",
        targetId: deviceId,
        metadata: {
          networkId: network.id,
          hostname: device.hostname,
          operation: "block",
          note: "the device still knows the network secret until it is rotated",
        },
      });
    }
    if (network.accessMode === "credentials" && device.role === "member") {
      await this.options.credentials?.revokeForDevice({
        orgId: actor.orgId,
        userId: actor.userId,
        deviceId,
        reason: "device blocked",
      });
    }
    this.publishDevice(updated, "blocked", { online: "offline" });
    // A blocked hub no longer contributes endpoints to the other devices.
    await this.repushNetwork(device.networkId, "device blocked");
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return this.dto(updated, network, tags.get(deviceId) ?? []);
  }

  async remove(
    actor: RequestActor,
    deviceId: string,
    options: { acknowledgeAnchorRisk?: boolean } = {},
  ): Promise<void> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    this.assertAnchorRemoval(network, device, "delete", options);
    const client = this.findClient(device);
    if (client) await this.stopInstance(client, device);
    client?.close("device was deleted");
    if (network.accessMode === "credentials" && device.role === "member") {
      await this.options.credentials?.revokeForDevice({
        orgId: actor.orgId,
        userId: actor.userId,
        deviceId,
        reason: "device deleted",
      });
    }
    this.notifyRemoved(device);
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
        ...(network.accessMode === "credentials" && device.role === "anchor"
          ? { anchorRemovalAcknowledged: true }
          : {}),
      },
    });
    if (network.accessMode === "credentials" && device.role === "anchor") {
      await this.options.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: "device.anchor_removed_acknowledged",
        targetType: "device",
        targetId: deviceId,
        metadata: {
          networkId: network.id,
          hostname: device.hostname,
          operation: "delete",
          note: "the device still knows the network secret until it is rotated",
        },
      });
    }
    await this.repushNetwork(device.networkId, "device deleted");
  }

  /**
   * Anchors hold the network secret. Removing one cannot revoke that knowledge:
   * only rotating the secret can. The API therefore requires an explicit
   * acknowledgement, which is audited; the UI explains the choice and offers
   * the rotation procedure.
   */
  private assertAnchorRemoval(
    network: Network,
    device: Device,
    action: "block" | "delete",
    options: { acknowledgeAnchorRisk?: boolean },
  ): void {
    if (network.accessMode !== "credentials") return;
    if (effectiveRole(network.accessMode, device.role) !== "anchor") return;
    if (!options.acknowledgeAnchorRisk) {
      throw new AppError(
        409,
        "this device is an anchor and already knows the network secret. " +
          "Removing it does not revoke it: rotate the network secret afterwards, " +
          "or repeat the request with acknowledgeAnchorRisk to accept the risk.",
        "anchor_removal_requires_acknowledgement",
      );
    }
  }

  /** Loads a device row for routes that need network/role information. */
  async requireDevice(orgId: string, deviceId: string): Promise<Device> {
    const device = await getDevice(this.options.db, orgId, deviceId);
    if (!device) notFound("device not found");
    return device;
  }

  /**
   * Issues a fresh credential for a member (new keypair). The member's config
   * identity changes, so it is repushed; anchors are repushed by the
   * credential service. Admin-only at the route level.
   */
  async renewCredential(
    actor: RequestActor,
    deviceId: string,
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    if (network.accessMode !== "credentials") {
      conflict("this network uses a shared secret; there is no credential to renew");
    }
    if (device.role !== "member") {
      conflict("anchors hold the network secret and have no credential");
    }
    const tags = (await this.tagsByDevice(actor.orgId, deviceId)).get(deviceId) ?? [];
    await this.options.credentials?.issueForDevice({
      network,
      device,
      userId: actor.userId,
      reason: "manual credential renewal",
      force: true,
      tags,
    });
    this.options.push.schedule(deviceId, "credential renewed");
    const updated = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!updated) notFound("device not found");
    this.publishDevice(updated, "credential-renewed");
    return this.dto(updated, network, tags);
  }

  /**
   * One-click revoke for a member: kill the credential *and* block the device
   * so it cannot reconnect with the (now dead) key. Re-approving issues a new
   * credential. Anchors are handled by `block`/`remove` with the explicit
   * acknowledgement, because only a secret rotation can actually revoke them.
   */
  async revokeCredential(
    actor: RequestActor,
    deviceId: string,
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    if (network.accessMode !== "credentials") {
      conflict("this network uses a shared secret; block the device instead");
    }
    if (device.role === "anchor") {
      conflict(
        "this device is an anchor: it holds the network secret, so a credential revoke does not remove its access. " +
          "Rotate the network secret, or remove the device and acknowledge the risk.",
      );
    }
    await this.options.credentials?.revokeForDevice({
      orgId: actor.orgId,
      userId: actor.userId,
      deviceId,
      reason: "credential revoked from the panel",
    });
    // Blocking stops the running instance and refuses further heartbeats.
    return this.block(actor, deviceId);
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
    return this.options.push.retry(deviceId);
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
    if (input.config.hostname !== undefined) {
      invalid(
        "hostname is the device's unique DNS name; use PUT /api/devices/:deviceId/hostname to rename it",
      );
    }

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
      policyVersion: network.policyVersion,
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
        policyVersion: revision.policyVersion,
      },
    });
    this.options.push.schedule(deviceId, "revision created");
    this.publishDevice(updated, "revision-created");
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return {
      revision: this.revisionToDto(revision),
      device: await this.dto(updated, network, tags.get(deviceId) ?? []),
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
      policyVersion: target.policyVersion,
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
      metadata: {
        revision: revision.revision,
        rollbackOf: targetRevision,
        policyVersion: revision.policyVersion,
      },
    });
    this.options.push.schedule(deviceId, "rollback");
    this.publishDevice(updated, "rollback");
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return {
      revision: this.revisionToDto(revision),
      device: await this.dto(updated, network, tags.get(deviceId) ?? []),
    };
  }

  /**
   * Renames a device's unique DNS name. MagicDNS records and the pushed
   * `hostname` follow it; a new revision is not needed because the name is
   * device identity, not revision content.
   */
  async rename(actor: RequestActor, deviceId: string, requested: string): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    const label = requested.trim().toLowerCase();
    if (!isValidDnsLabel(label)) {
      invalid(
        "DNS name must be 1-63 lowercase letters, digits or dashes and must not start or end with a dash",
      );
    }
    const taken = await takenDnsNames(this.options.db, network.id, device.id);
    if (taken.some((name) => name.toLowerCase() === label)) {
      conflict(`the name "${label}" is already used in this network`);
    }
    const previous = device.dnsName;
    const updated = await updateDevice(this.options.db, deviceId, { dnsName: label });
    if (!updated) throw new AppError(500, "failed to rename device");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.renamed",
      targetType: "device",
      targetId: deviceId,
      metadata: { previous, dnsName: label, networkId: network.id },
    });
    this.options.push.schedule(deviceId, "renamed");
    this.publishDevice(updated, "renamed");
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return this.dto(updated, network, tags.get(deviceId) ?? []);
  }

  /** Replaces a device's tags (policy subjects of kind `tag:`). */
  async setTags(actor: RequestActor, deviceId: string, tags: string[]): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    const requested = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    // Policy imports store `tag:ru`, the API and UI use plain `ru`: match on the
    // bare name and write the stored spelling.
    const bare = (name: string) => name.replace(/^tag:/i, "").toLowerCase();
    const knownRows = await listTags(this.options.db, actor.orgId);
    const byBare = new Map(knownRows.map((tag) => [bare(tag.name), tag.name]));
    const unknown = requested.filter((tag) => !byBare.has(bare(tag)));
    if (unknown.length > 0) {
      invalid(`unknown tag(s): ${unknown.join(", ")}`);
    }
    const normalized = [
      ...new Set(requested.map((tag) => byBare.get(bare(tag)) as string)),
    ];
    await setDeviceTags(this.options.db, deviceId, normalized);
    const updated = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!updated) notFound("device not found");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.tags_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: { tags: normalized, networkId: network.id },
    });
    if (network.accessMode === "credentials" && device.role === "member") {
      // Credential groups are EasyTier ACL group names; keep them in sync with
      // the device's tags so `source_groups` rules keep matching.
      await this.options.credentials?.syncGroupsForDevice(
        deviceId,
        normalized,
        actor.userId,
        actor.orgId,
      );
    }
    // A tag change changes the compiled ACL of other devices in the network.
    this.options.push.schedule(deviceId, "tags updated");
    this.publishDevice(updated, "tags-updated");
    return this.dto(updated, network, normalized);
  }

  /**
   * Sets or clears the short human description. It lives only in the panel —
   * it is never compiled into the client config — so no push is scheduled; the
   * realtime event refreshes open lists in other tabs.
   */
  async setDescription(
    actor: RequestActor,
    deviceId: string,
    requested: string | null,
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    const description = normalizeDeviceDescription(requested);
    if (description && !isDeviceDescriptionLengthValid(description)) {
      invalid(
        `description must be at most ${DEVICE_DESCRIPTION_MAX_LENGTH} characters`,
      );
    }
    const previous = device.description;
    if (previous === description) {
      const tags = await this.tagsByDevice(actor.orgId, deviceId);
      return this.dto(device, network, tags.get(deviceId) ?? []);
    }
    const updated = await updateDevice(this.options.db, deviceId, { description });
    if (!updated) {
      throw new AppError(500, "failed to update the device description");
    }
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.description_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: { previous, description, networkId: network.id },
    });
    // Explicit reasons always publish: the status signature does not track
    // description, so dedupe must not swallow this change.
    this.publishDevice(updated, "description-updated");
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return this.dto(updated, network, tags.get(deviceId) ?? []);
  }

  /** Assigns the owning account used by policy `group:` subjects. */
  async setOwner(
    actor: RequestActor,
    deviceId: string,
    ownerUserId: string | null,
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    if (ownerUserId) {
      const user = await findUserById(this.options.db, ownerUserId);
      if (!user || user.orgId !== actor.orgId) notFound("user not found");
    }
    const updated = await updateDevice(this.options.db, deviceId, { ownerUserId });
    if (!updated) throw new AppError(500, "failed to update the device owner");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.owner_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: { ownerUserId, previousOwner: device.ownerUserId },
    });
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    this.publishDevice(updated, "owner-updated");
    return this.dto(updated, network, tags.get(deviceId) ?? []);
  }

  /**
   * Replaces the peer URLs other devices dial to reach this one. Endpoints are
   * validated against the schemes the pinned easytier-core accepts. Because the
   * compiled peer list is network state, every approved device is re-evaluated
   * (the push service skips devices that are already in sync).
   */
  async setAdvertisedEndpoints(
    actor: RequestActor,
    deviceId: string,
    endpoints: readonly string[],
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    const normalized = this.normalizeAdvertisedEndpoints(endpoints);
    const updated = await updateDevice(this.options.db, deviceId, {
      advertisedEndpoints: normalized,
    });
    if (!updated) throw new AppError(500, "failed to update advertised endpoints");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.endpoints_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: {
        networkId: network.id,
        previous: device.advertisedEndpoints,
        endpoints: normalized,
      },
    });
    await this.repushNetwork(network.id, "peer endpoints updated");
    this.options.realtime?.publish({
      type: "network.updated",
      orgId: actor.orgId,
      networkId: network.id,
      data: { networkId: network.id, reason: "peer-endpoints-updated" },
    });
    this.publishDevice(updated, "endpoints-updated");
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return this.dto(updated, network, tags.get(deviceId) ?? []);
  }

  /**
   * Marks a device as a hub: it is added to the network's ordered peer list as
   * a device-backed entry, so every other device dials its advertised
   * endpoints. Clearing the flag removes that entry (raw URLs linked to the
   * device are left alone).
   *
   * The same request can save the hub's listen/external ports and extra
   * advertised addresses, so the device page has a single Save action.
   */
  async setHub(
    actor: RequestActor,
    deviceId: string,
    isHub: boolean,
    settings: HubUpdateSettings = {},
  ): Promise<DeviceDto> {
    const device = await getDevice(this.options.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    for (const port of [settings.listenPort, settings.externalPort]) {
      if (port !== undefined && port !== null && !isValidHubPort(port)) {
        invalid("a port must be between 1 and 65535");
      }
    }
    const endpoints =
      settings.endpoints !== undefined
        ? this.normalizeAdvertisedEndpoints(settings.endpoints)
        : undefined;
    if (!isHub && device.isHub && device.wgListenPort !== null) {
      const clients = await countWireguardClientsForHub(this.options.db, deviceId);
      if (clients > 0) {
        throw new AppError(
          409,
          `this hub serves ${clients} WireGuard client(s). Delete them and disable the WireGuard portal before turning the hub off.`,
          "wireguard_portal_has_clients",
        );
      }
    }
    const updated = await updateDevice(this.options.db, deviceId, {
      isHub,
      ...(settings.listenPort !== undefined
        ? { listenPort: settings.listenPort }
        : {}),
      ...(settings.externalPort !== undefined
        ? { externalPort: settings.externalPort }
        : {}),
      ...(endpoints !== undefined ? { advertisedEndpoints: endpoints } : {}),
    });
    if (!updated) throw new AppError(500, "failed to update the hub flag");
    if (isHub) {
      const existing = await findDeviceBackedPeer(
        this.options.db,
        network.id,
        deviceId,
      );
      if (!existing) {
        await insertNetworkPeer(this.options.db, {
          orgId: actor.orgId,
          networkId: network.id,
          deviceId,
          url: null,
          position: await nextNetworkPeerPosition(this.options.db, network.id),
          createdBy: actor.userId,
        });
      }
    } else {
      await deleteDeviceBackedPeers(this.options.db, network.id, deviceId);
      await compactNetworkPeerPositions(this.options.db, network.id);
    }
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: isHub ? "device.hub_enabled" : "device.hub_disabled",
      targetType: "device",
      targetId: deviceId,
      metadata: {
        networkId: network.id,
        endpoints: updated.advertisedEndpoints,
        listenPort: updated.listenPort,
        externalPort: updated.externalPort,
      },
    });
    await this.repushNetwork(network.id, isHub ? "hub enabled" : "hub disabled");
    this.options.realtime?.publish({
      type: "network.updated",
      orgId: actor.orgId,
      networkId: network.id,
      data: { networkId: network.id, reason: "hub-updated" },
    });
    this.publishDevice(updated, "hub-updated");
    const tags = await this.tagsByDevice(actor.orgId, deviceId);
    return this.dto(updated, network, tags.get(deviceId) ?? []);
  }

  /** Validates, trims and de-duplicates a hub's extra advertised URLs. */
  private normalizeAdvertisedEndpoints(
    endpoints: readonly string[],
  ): string[] {
    let normalized: string[];
    try {
      normalized = dedupePeerUrls(
        endpoints.map((endpoint) => endpoint.trim()).filter(Boolean),
      );
    } catch (error) {
      invalid(error instanceof Error ? error.message : "invalid endpoint URL");
    }
    if (normalized.length > 16) {
      invalid("a device can advertise at most 16 endpoints");
    }
    return normalized;
  }

  /**
   * Re-schedules every approved device of a network after network-level peer
   * state changed (hub endpoint, hub approval/block/removal). `ensure` verifies
   * the reported config first, so an unchanged device is not actually
   * repushed.
   */
  private async repushNetwork(networkId: string, reason: string): Promise<void> {
    const devices = await listApprovedDevicesInNetwork(this.options.db, networkId);
    for (const device of devices) {
      this.options.push.schedule(device.id, reason);
    }
  }

  /**
   * Called on config-server session close: only bookkeeping. The online flag is
   * derived from lastSeenAt, so no DB write is needed here; keeping the hook
   * makes the lifecycle explicit and lets tests observe it.
   */
  handleSessionClosed(client: ManagedClient): void {
    const deviceId = this.options.sessions.deviceForClient(client);
    this.options.sessions.unbindClient(client);
    if (deviceId) {
      void this.notifyDevice(deviceId, "session-closed", { online: "offline" });
    }
  }

  /** Hash helper kept here so tests can assert token storage without a DB. */
  static hashToken(token: string): string {
    return sha256Hex(token);
  }
}
