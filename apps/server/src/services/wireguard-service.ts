import type { DbExecutor } from "../db/repositories.js";
import {
  approvedRoutesForNetwork,
  countWireguardClientsForHub,
  deleteWireguardClient,
  findUserById,
  findWireguardClientByName,
  getDeviceById,
  getNetworkById,
  getWireguardClient,
  insertWireguardClient,
  listDevicesInNetwork,
  listOrgWireguardClients,
  listTags,
  listWireguardClients,
  listWireguardClientsForHub,
  recordWireguardStatus,
  takenDnsNames,
  updateDevice,
  updateWireguardClient,
  usedVirtualIps,
} from "../db/repositories.js";
import type { instance } from "@easyplane/proto";

import type { Device, Network, WireguardClient } from "../db/schema.js";
import { allocateIpv4, formatIpv4, parseCidr } from "../domain/ip.js";
import { isValidDnsLabel } from "../domain/magic-dns.js";
import {
  DEFAULT_LEGACY_CLIENT_CIDR,
  DEFAULT_WIREGUARD_PORT,
  MAX_WIREGUARD_CLIENTS_PER_HUB,
  PER_CLIENT_PORTAL_MIN_VERSION,
  cidrOverlapsAny,
  interpretPortalProbe,
  isValidWireguardPort,
  legacyClientConfig,
  legacyConnectedClients,
  legacyPortalConfigHint,
  legacyPortalReplyError,
  portalListener,
  portalModeForDevice,
  portalStatuses,
  portalVirtualIpProblem,
  findClientConfig,
  readPortalSnapshot,
  withPortalSnapshot,
  type WireguardClientState,
  type WireguardPortalMode,
} from "../domain/wireguard.js";
import type { ManagedClient } from "../control/managed-client.js";
import type { Logger } from "../logger.js";
import type { RealtimeEventData } from "../realtime/events.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { generateCredentialKeypair } from "../security/credential-keys.js";
import type { SecretBox } from "../security/crypto.js";
import type { AuditService } from "./audit.js";
import type { DeviceSessionRegistry } from "./device-sessions.js";
import { AppError, conflict, invalid, notFound } from "./errors.js";
import type { RequestActor } from "./device-service.js";
import { instanceIdFor, type PushService } from "./push-service.js";

export interface WireguardClientDto {
  id: string;
  networkId: string;
  hubDeviceId: string;
  /** Hub name shown in the UI (DNS name when available). */
  hubHostname: string;
  name: string;
  virtualIpv4: string;
  tags: string[];
  ownerUserId: string | null;
  /** Last `GetVpnPortalInfo` state; `unknown` before the first successful probe. */
  state: WireguardClientState;
  /** Underlay address the WireGuard handshake came from. */
  endpoint: string | null;
  /** Tunnel address reported by the portal, when connected. */
  tunnelIp: string | null;
  peerId: number | null;
  error: string | null;
  statusAt: string | null;
  createdAt: string;
}

export interface CreateWireguardClientInput {
  name: string;
  tags?: string[];
  hubDeviceId?: string;
  ownerUserId?: string | null;
}

export interface WireguardPortalSettingsDto {
  enabled: boolean;
  port: number | null;
  clientCount: number;
  /** Which EasyTier portal generation this hub supports. */
  mode: WireguardPortalMode;
  /** Legacy (< 2.7.0) portal pool; null in per-client mode or when unset. */
  legacyClientCidr: string | null;
}

export interface WireguardPortalConfigDto {
  /** Ready-to-use WireGuard config (contains a private key); never cached. */
  config: string;
  filename: string;
  mode: WireguardPortalMode;
  port: number | null;
  clientCidr: string | null;
  /** Names the legacy portal reports as connected (2.6.x string form). */
  connectedClients: string[];
  listener: string | null;
}

export interface WireguardServiceOptions {
  db: DbExecutor;
  secretBox: SecretBox;
  audit: AuditService;
  push: PushService;
  sessions: DeviceSessionRegistry;
  logger: Logger;
  realtime?: RealtimeHub;
}

function statusRecord(row: WireguardClient): Record<string, unknown> {
  return row.reportedStatus && typeof row.reportedStatus === "object"
    ? row.reportedStatus
    : {};
}

function dto(row: WireguardClient, hub: Device | undefined): WireguardClientDto {
  const status = statusRecord(row);
  const state = status.state as WireguardClientState | undefined;
  const stringOrNull = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    id: row.id,
    networkId: row.networkId,
    hubDeviceId: row.hubDeviceId,
    hubHostname: hub ? (hub.dnsName ?? hub.hostname) : "",
    name: row.name,
    virtualIpv4: row.virtualIpv4,
    tags: [...row.tags],
    ownerUserId: row.ownerUserId,
    state: state ?? "unknown",
    endpoint: stringOrNull(status.endpoint),
    tunnelIp: stringOrNull(status.tunnelIp),
    peerId: numberOrNull(status.peerId),
    error: stringOrNull(status.error),
    statusAt: row.reportedStatusAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * WireGuard portal clients: CRUD, allocation from the network address pool,
 * portal enable/disable on a hub, on-demand config download and live status.
 *
 * Client keypairs are derived by the hub from its master key and the client
 * name, so this service stores no per-client secret. The ready-to-use config
 * (which contains that key) is fetched from the hub for one authorised request
 * and never persisted or logged.
 */
export class WireguardService {
  /** Same read-then-write protection as device approval (single process). */
  private readonly networkLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: WireguardServiceOptions) {}

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

  /** Portal generation this hub supports (see `domain/wireguard.ts`). */
  private mode(hub: Device): WireguardPortalMode {
    return portalModeForDevice(hub);
  }

  /**
   * Per-client portal management needs EasyTier >= 2.7.0. On 2.6.x the panel
   * cannot push or address named clients at all, so the request is refused
   * with a precise code instead of silently doing nothing.
   */
  private assertPerClientPortal(hub: Device): void {
    if (this.mode(hub) === "per-client") {
      const snapshot = readPortalSnapshot(hub.reportedState);
      if (snapshot?.state === "unsupported") {
        throw new AppError(
          409,
          "this hub's EasyTier build has no WireGuard support; install or update to a build compiled with the wireguard feature",
          "wireguard_portal_unsupported",
        );
      }
      return;
    }
    throw new AppError(
      409,
      `per-client WireGuard clients need EasyTier ${PER_CLIENT_PORTAL_MIN_VERSION} or newer on the hub, but this hub reports "${hub.easytierVersion || "an unknown version"}". Use subnet mode (one shared config) instead.`,
      "wireguard_portal_needs_newer_easytier",
    );
  }

  private async loadNetwork(
    actor: RequestActor,
    networkId: string,
  ): Promise<Network> {
    const network = await getNetworkById(this.options.db, networkId);
    if (!network || network.orgId !== actor.orgId) notFound("network not found");
    return network;
  }

  async list(
    actor: RequestActor,
    networkId: string,
  ): Promise<WireguardClientDto[]> {
    const network = await this.loadNetwork(actor, networkId);
    const [rows, devices] = await Promise.all([
      listWireguardClients(this.options.db, network.id),
      listDevicesInNetwork(this.options.db, network.id),
    ]);
    const byId = new Map(devices.map((device) => [device.id, device]));
    return rows.map((row) => dto(row, byId.get(row.hubDeviceId)));
  }

  async listForOrg(actor: RequestActor): Promise<WireguardClientDto[]> {
    const rows = await listOrgWireguardClients(this.options.db, actor.orgId);
    const devices = new Map<string, Device>();
    for (const row of rows) {
      if (devices.has(row.hubDeviceId)) continue;
      const device = await getDeviceById(this.options.db, row.hubDeviceId);
      if (device) devices.set(row.hubDeviceId, device);
    }
    return rows.map((row) => dto(row, devices.get(row.hubDeviceId)));
  }

  async get(actor: RequestActor, clientId: string): Promise<WireguardClientDto> {
    const { client, hub } = await this.requireClient(actor, clientId);
    return dto(client, hub);
  }

  private async requireClient(
    actor: RequestActor,
    clientId: string,
  ): Promise<{ client: WireguardClient; network: Network; hub: Device }> {
    const client = await getWireguardClient(this.options.db, actor.orgId, clientId);
    if (!client) notFound("WireGuard client not found");
    const network = await getNetworkById(this.options.db, client.networkId);
    if (!network) notFound("network not found");
    const hub = await getDeviceById(this.options.db, client.hubDeviceId);
    if (!hub) notFound("hub device not found");
    return { client, network, hub };
  }

  private validateName(value: string): string {
    const name = value.trim().toLowerCase();
    if (!isValidDnsLabel(name)) {
      invalid(
        "name must be 1-63 lowercase letters, digits or dashes and must not start or end with a dash",
      );
    }
    return name;
  }

  private normalizeTags(tags: string[] | undefined): string[] {
    return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  }

  private async assertTagsKnown(orgId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    const known = new Set(
      (await listTags(this.options.db, orgId)).map((tag) =>
        tag.name.replace(/^tag:/i, "").toLowerCase(),
      ),
    );
    // Policy imports store `tag:ru`, the API and UI use plain `ru`.
    const unknown = tags.filter(
      (tag) => !known.has(tag.replace(/^tag:/i, "").toLowerCase()),
    );
    if (unknown.length > 0) invalid(`unknown tag(s): ${unknown.join(", ")}`);
  }

  private async assertNameFree(
    networkId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await findWireguardClientByName(
      this.options.db,
      networkId,
      name,
      excludeId,
    );
    if (existing) conflict(`the name "${name}" is already used in this network`);
    // Device DNS names share the policy namespace (`device:<name>`), so a
    // client may not shadow a device either.
    const taken = await takenDnsNames(this.options.db, networkId);
    if (taken.some((entry) => entry.toLowerCase() === name)) {
      conflict(`the name "${name}" is already used by a device in this network`);
    }
  }

  /** Picks the hub for a new client: explicit, or the only approved hub. */
  private async resolveHub(
    network: Network,
    requestedHubId: string | undefined,
  ): Promise<Device> {
    if (requestedHubId) {
      const hub = await getDeviceById(this.options.db, requestedHubId);
      if (!hub || hub.networkId !== network.id) {
        invalid("the selected hub is not a device of this network");
      }
      if (hub.state !== "approved") {
        throw new AppError(
          409,
          "the WireGuard portal can only run on an approved hub device",
          "wireguard_portal_hub_not_approved",
        );
      }
      if (!hub.isHub) {
        throw new AppError(
          409,
          "the selected device is not a hub; only a hub can serve WireGuard clients",
          "wireguard_portal_hub_required",
        );
      }
      return hub;
    }
    const hubs = (await listDevicesInNetwork(this.options.db, network.id)).filter(
      (device) => device.isHub && device.state === "approved",
    );
    if (hubs.length === 0) {
      throw new AppError(
        409,
        "this network has no approved hub. Enable the WireGuard portal on a hub first.",
        "wireguard_portal_hub_required",
      );
    }
    if (hubs.length > 1) {
      invalid("choose which hub should serve this WireGuard client");
    }
    return hubs[0]!;
  }

  /**
   * Ensures the portal is on for the hub. A client cannot be served by a
   * disabled portal, and requiring an extra trip to the hub page to flip a
   * switch is a poor first-run experience, so enabling is implicit and audited.
   */
  private async ensurePortal(
    actor: RequestActor,
    hub: Device,
  ): Promise<Device> {
    if (hub.wgListenPort !== null) return hub;
    const port = DEFAULT_WIREGUARD_PORT;
    if (!isValidWireguardPort(port)) throw new AppError(500, "invalid default port");
    const keypair = generateCredentialKeypair();
    const updated = await updateDevice(this.options.db, hub.id, {
      wgListenPort: port,
      wgPrivateKeyCiphertext: this.options.secretBox.encrypt(keypair.secret),
    });
    if (!updated) throw new AppError(500, "failed to enable the WireGuard portal");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.wireguard_portal_enabled",
      targetType: "device",
      targetId: hub.id,
      metadata: { networkId: hub.networkId, port, reason: "first WireGuard client" },
    });
    return updated;
  }

  async create(
    actor: RequestActor,
    networkId: string,
    input: CreateWireguardClientInput,
  ): Promise<WireguardClientDto> {
    const network = await this.loadNetwork(actor, networkId);
    const name = this.validateName(input.name);
    const tags = this.normalizeTags(input.tags);
    await this.assertTagsKnown(actor.orgId, tags);
    if (input.ownerUserId) {
      const user = await findUserById(this.options.db, input.ownerUserId);
      if (!user || user.orgId !== actor.orgId) notFound("user not found");
    }
    return this.withNetworkLock(network.id, async () => {
      await this.assertNameFree(network.id, name);
      const hub = await this.resolveHub(network, input.hubDeviceId);
      this.assertPerClientPortal(hub);
      await this.ensurePortal(actor, hub);
      const count = await countWireguardClientsForHub(this.options.db, hub.id);
      if (count >= MAX_WIREGUARD_CLIENTS_PER_HUB) {
        throw new AppError(
          409,
          `a hub serves at most ${MAX_WIREGUARD_CLIENTS_PER_HUB} WireGuard clients`,
          "wireguard_client_limit",
        );
      }
      // Same allocator and used-address set as device approval: a client can
      // never collide with a device or another client.
      const used = await usedVirtualIps(this.options.db, network.id);
      const address = allocateIpv4(network.ipv4Cidr, used);
      if (!address) {
        throw new AppError(
          409,
          `no free address left in ${network.ipv4Cidr}`,
          "address_pool_exhausted",
        );
      }
      // Defence in depth: EasyTier refuses a portal client on the hub's own
      // address or on the first/last address of its prefix ("unusable virtual
      // IP") and that failure takes the whole instance down. The allocator
      // already excludes those, so this only catches corrupt rows.
      const addressProblem = portalVirtualIpProblem({
        virtualIpv4: address,
        prefixLength: parseCidr(network.ipv4Cidr).prefix,
        hubVirtualIpv4: hub.virtualIpv4,
      });
      if (addressProblem) {
        throw new AppError(
          409,
          `the allocated address ${address} cannot be used by a WireGuard client: it ${addressProblem}`,
          "wireguard_unusable_address",
        );
      }
      const row = await insertWireguardClient(this.options.db, {
        orgId: actor.orgId,
        networkId: network.id,
        hubDeviceId: hub.id,
        name,
        virtualIpv4: address,
        tags,
        ownerUserId: input.ownerUserId ?? actor.userId,
      });
      await this.options.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: "wireguard_client.created",
        targetType: "wireguard_client",
        targetId: row.id,
        metadata: {
          networkId: network.id,
          hubDeviceId: hub.id,
          name,
          virtualIpv4: address,
          tags,
        },
      });
      // The hub's pushed config carries the client list; nobody else changes.
      this.options.push.schedule(hub.id, "wireguard client created");
      this.publish(network.orgId, network.id, { clientId: row.id, hubDeviceId: hub.id, reason: "created" });
      return dto(row, hub);
    });
  }

  async rename(
    actor: RequestActor,
    clientId: string,
    requested: string,
  ): Promise<WireguardClientDto> {
    const { client, network, hub } = await this.requireClient(actor, clientId);
    this.assertPerClientPortal(hub);
    const name = this.validateName(requested);
    return this.withNetworkLock(network.id, async () => {
      await this.assertNameFree(network.id, name, client.id);
      const updated = await updateWireguardClient(this.options.db, client.id, {
        name,
      });
      if (!updated) throw new AppError(500, "failed to rename the WireGuard client");
      await this.options.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: "wireguard_client.renamed",
        targetType: "wireguard_client",
        targetId: client.id,
        metadata: { networkId: network.id, previous: client.name, name },
      });
      this.options.push.schedule(hub.id, "wireguard client renamed");
      this.publish(network.orgId, network.id, { clientId: client.id, hubDeviceId: hub.id, reason: "renamed" });
      return dto(updated, hub);
    });
  }

  async setTags(
    actor: RequestActor,
    clientId: string,
    tags: string[],
  ): Promise<WireguardClientDto> {
    const { client, network, hub } = await this.requireClient(actor, clientId);
    this.assertPerClientPortal(hub);
    const normalized = this.normalizeTags(tags);
    await this.assertTagsKnown(actor.orgId, normalized);
    const updated = await updateWireguardClient(this.options.db, client.id, {
      tags: normalized,
    });
    if (!updated) throw new AppError(500, "failed to update the WireGuard client tags");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "wireguard_client.tags_updated",
      targetType: "wireguard_client",
      targetId: client.id,
      metadata: { networkId: network.id, tags: normalized },
    });
    this.options.push.schedule(hub.id, "wireguard client tags updated");
    this.publish(network.orgId, network.id, { clientId: client.id, hubDeviceId: hub.id, reason: "tags" });
    return dto(updated, hub);
  }

  async remove(actor: RequestActor, clientId: string): Promise<void> {
    const { client, network, hub } = await this.requireClient(actor, clientId);
    await deleteWireguardClient(this.options.db, client.id);
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "wireguard_client.deleted",
      targetType: "wireguard_client",
      targetId: client.id,
      metadata: {
        networkId: network.id,
        hubDeviceId: hub.id,
        name: client.name,
        virtualIpv4: client.virtualIpv4,
      },
    });
    this.options.push.schedule(hub.id, "wireguard client deleted");
    this.publish(network.orgId, network.id, { clientId: client.id, hubDeviceId: hub.id, reason: "deleted" });
  }

  /**
   * Portal toggle for a hub. Disabling is refused while per-client clients
   * exist (their configs would keep pointing at a closed port).
   *
   * The accepted input depends on the hub's EasyTier generation:
   * - per-client (>= 2.7.0): port + master key, client rows are pushed;
   * - legacy (< 2.7.0): port + client CIDR, stored as operator intent because
   *   2.6.x has no protocol field for the portal.
   */
  async updatePortal(
    actor: RequestActor,
    deviceId: string,
    input: { enabled: boolean; port?: number | null; clientCidr?: string | null },
  ): Promise<WireguardPortalSettingsDto> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device || device.orgId !== actor.orgId) notFound("device not found");
    const mode = this.mode(device);
    if (input.enabled) {
      if (device.state !== "approved") {
        throw new AppError(
          409,
          "the WireGuard portal needs an approved hub device",
          "wireguard_portal_hub_not_approved",
        );
      }
      if (!device.isHub) {
        throw new AppError(
          409,
          "only a hub can serve WireGuard clients; enable the hub first",
          "wireguard_portal_hub_required",
        );
      }
      const port = input.port ?? device.wgListenPort ?? DEFAULT_WIREGUARD_PORT;
      if (!isValidWireguardPort(port)) invalid("port must be between 1 and 65535");
      if (mode !== "per-client") {
        const clientCidr = await this.resolveLegacyClientCidr(
          device,
          input.clientCidr ?? device.wgLegacyClientCidr ?? DEFAULT_LEGACY_CLIENT_CIDR,
        );
        const updated = await updateDevice(this.options.db, device.id, {
          wgListenPort: port,
          wgLegacyClientCidr: clientCidr,
        });
        if (!updated) throw new AppError(500, "failed to enable the WireGuard portal");
        await this.options.audit.record({
          orgId: actor.orgId,
          actorUserId: actor.userId,
          action:
            device.wgListenPort === null
              ? "device.wireguard_portal_enabled"
              : "device.wireguard_portal_updated",
          targetType: "device",
          targetId: device.id,
          metadata: { networkId: device.networkId, port, mode, clientCidr },
        });
        // The pushed config carries no portal field in this generation; a push
        // clears a stale per-client portal left over from an earlier config.
        this.options.push.schedule(device.id, "wireguard portal updated");
        this.publish(device.orgId, device.networkId, {
          hubDeviceId: device.id,
          reason: "portal-updated",
        });
        return {
          enabled: true,
          port,
          clientCount: await countWireguardClientsForHub(this.options.db, device.id),
          mode,
          legacyClientCidr: clientCidr,
        };
      }
      const keypair = device.wgPrivateKeyCiphertext
        ? null
        : generateCredentialKeypair();
      const updated = await updateDevice(this.options.db, device.id, {
        wgListenPort: port,
        ...(keypair
          ? { wgPrivateKeyCiphertext: this.options.secretBox.encrypt(keypair.secret) }
          : {}),
      });
      if (!updated) throw new AppError(500, "failed to enable the WireGuard portal");
      await this.options.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action:
          device.wgListenPort === null
            ? "device.wireguard_portal_enabled"
            : "device.wireguard_portal_updated",
        targetType: "device",
        targetId: device.id,
        metadata: { networkId: device.networkId, port, mode },
      });
      this.options.push.schedule(device.id, "wireguard portal updated");
      this.publish(device.orgId, device.networkId, {
        hubDeviceId: device.id,
        reason: "portal-updated",
      });
      return {
        enabled: true,
        port,
        clientCount: await countWireguardClientsForHub(this.options.db, device.id),
        mode,
        legacyClientCidr: null,
      };
    }
    const clientCount = await countWireguardClientsForHub(this.options.db, device.id);
    if (clientCount > 0 && mode === "per-client") {
      throw new AppError(
        409,
        `this hub still serves ${clientCount} WireGuard client(s). Delete them before disabling the portal.`,
        "wireguard_portal_has_clients",
      );
    }
    await updateDevice(this.options.db, device.id, {
      wgListenPort: null,
      wgPrivateKeyCiphertext: null,
      wgLegacyClientCidr: null,
    });
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "device.wireguard_portal_disabled",
      targetType: "device",
      targetId: device.id,
      metadata: { networkId: device.networkId, port: device.wgListenPort, mode },
    });
    this.options.push.schedule(device.id, "wireguard portal disabled");
    this.publish(device.orgId, device.networkId, { hubDeviceId: device.id, reason: "portal-disabled" });
    return { enabled: false, port: null, clientCount: 0, mode, legacyClientCidr: null };
  }

  /**
   * Validates the legacy portal pool: a CIDR that does not overlap the
   * network's own address pool or any approved subnet route (and therefore
   * no device or per-client address, which all live inside those).
   */
  private async resolveLegacyClientCidr(
    device: Device,
    requested: string,
  ): Promise<string> {
    const value = requested.trim();
    let parsed;
    try {
      parsed = parseCidr(value);
    } catch {
      invalid(
        "clientCidr must be an IPv4 CIDR with a prefix between 8 and 30 (for example 10.14.14.0/24)",
      );
    }
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) notFound("network not found");
    const routes = await approvedRoutesForNetwork(this.options.db, network.id);
    const conflicts = [
      network.ipv4Cidr,
      ...routes
        .filter((route) => route.kind === "subnet")
        .map((route) => route.cidr),
    ];
    if (cidrOverlapsAny(value, conflicts)) {
      invalid(
        `clientCidr ${value} overlaps the network address pool or an approved subnet route; pick a separate range such as ${DEFAULT_LEGACY_CLIENT_CIDR}`,
      );
    }
    // Normalise to the network address so the value stored is canonical.
    return `${formatIpv4(parsed.base)}/${parsed.prefix}`;
  }

  private async portalInfo(hub: Device): Promise<{
    info: instance.VpnPortalInfo | undefined;
    mode: WireguardPortalMode;
  }> {
    const mode = this.mode(hub);
    if (hub.state !== "approved") {
      throw new AppError(409, "the hub device is not approved", "wireguard_portal_hub_not_approved");
    }
    if (hub.wgListenPort === null) {
      throw new AppError(409, "the WireGuard portal is disabled on this hub", "wireguard_portal_disabled");
    }
    const client = this.options.sessions.get(hub.id);
    if (!client || client.isClosed) {
      throw new AppError(
        409,
        "the hub is offline; the config can be downloaded once it reconnects",
        "hub_offline",
      );
    }
    let response;
    try {
      response = await client.remote.getVpnPortalInfo(
        instanceIdFor(hub.networkId, hub.id),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger.warn("failed to read the WireGuard portal info", {
        hubDeviceId: hub.id,
        mode,
        error: message,
      });
      throw new AppError(
        409,
        `the hub did not answer the WireGuard portal query (${message.slice(0, 200)}); try again when it is online`,
        "wireguard_portal_unavailable",
      );
    }
    const info = response.vpnPortalInfo;
    if ((info?.vpnType ?? "").trim() === "null") {
      throw new AppError(
        409,
        "this EasyTier build has no WireGuard support (the portal reports vpn_type = null); install a build compiled with the wireguard feature",
        "wireguard_portal_unsupported",
      );
    }
    return { info, mode };
  }

  /**
   * The ready-made WireGuard config for one per-client client. Admin-only at
   * the route; the value contains a private key, so it is returned once, never
   * cached, audited or logged.
   */
  async clientConfig(
    actor: RequestActor,
    clientId: string,
  ): Promise<{ config: string; client: WireguardClientDto; filename: string }> {
    const { client, network, hub } = await this.requireClient(actor, clientId);
    if (this.mode(hub) !== "per-client") {
      throw new AppError(
        409,
        `per-client WireGuard configs need EasyTier ${PER_CLIENT_PORTAL_MIN_VERSION} or newer on the hub; this hub uses subnet mode, download the shared config instead`,
        "wireguard_portal_needs_newer_easytier",
      );
    }
    const { info } = await this.portalInfo(hub);
    const config = findClientConfig(info, client.name);
    if (!config) {
      const portalError = (info?.clients ?? []).find(
        (entry) => entry.name === client.name,
      )?.error;
      const legacyError = legacyPortalReplyError(info?.clientConfig);
      if (legacyError) {
        throw new AppError(
          409,
          `the WireGuard portal is not running on the hub: ${legacyError}`,
          "wireguard_portal_not_running",
        );
      }
      throw new AppError(
        409,
        portalError
          ? `the hub reported an error for this client: ${portalError}`
          : "the hub has not generated a config for this client yet; make sure the portal is running",
        "wireguard_config_unavailable",
      );
    }
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "wireguard_client.config_viewed",
      targetType: "wireguard_client",
      targetId: client.id,
      metadata: { networkId: network.id, hubDeviceId: hub.id, name: client.name },
    });
    return {
      config,
      client: dto(client, hub),
      filename: `${client.name}.conf`,
    };
  }

  /**
   * Shared WireGuard config of a legacy (< 2.7.0) portal. 2.6.x hands out one
   * ready-made config for the whole `client_cidr` pool; there are no named
   * clients. Same handling as the per-client config: admin-only, `no-store`,
   * never logged or persisted.
   */
  async legacyPortalConfig(
    actor: RequestActor,
    hubDeviceId: string,
  ): Promise<WireguardPortalConfigDto> {
    const hub = await getDeviceById(this.options.db, hubDeviceId);
    if (!hub || hub.orgId !== actor.orgId) notFound("device not found");
    if (!hub.isHub) {
      throw new AppError(
        409,
        "the WireGuard portal runs on a hub; this device is not a hub",
        "wireguard_portal_hub_required",
      );
    }
    const mode = this.mode(hub);
    if (mode === "per-client") {
      throw new AppError(
        409,
        "this hub uses per-client WireGuard; open the configuration of a specific client instead",
        "wireguard_portal_per_client_mode",
      );
    }
    const { info } = await this.portalInfo(hub);
    const replyError = legacyPortalReplyError(info?.clientConfig);
    if (replyError) {
      const hint =
        hub.wgListenPort !== null && hub.wgLegacyClientCidr
          ? ` Start EasyTier on the device with: ${legacyPortalConfigHint(hub.wgListenPort, hub.wgLegacyClientCidr).cli}`
          : "";
      throw new AppError(
        409,
        `the WireGuard portal is not running on the hub: ${replyError}.${hint}`,
        "wireguard_portal_not_running",
      );
    }
    const config = legacyClientConfig(info);
    if (!config) {
      throw new AppError(
        409,
        "the hub has not generated the shared WireGuard config yet",
        "wireguard_portal_not_running",
      );
    }
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "wireguard_portal.config_viewed",
      targetType: "device",
      targetId: hub.id,
      metadata: { networkId: hub.networkId, mode },
    });
    return {
      config,
      filename: `${hub.dnsName ?? hub.hostname ?? "wireguard"}.conf`,
      mode,
      port: hub.wgListenPort,
      clientCidr: hub.wgLegacyClientCidr,
      connectedClients: legacyConnectedClients(info),
      listener: portalListener(info),
    };
  }

  /**
   * Probes a hub's portal and records the generation, state and (for the
   * per-client generation) each client's live status. Called by the topology
   * collector for online devices with a portal enabled; failures are logged,
   * never thrown, so one hub cannot break a topology cycle.
   *
   * The probe runs even when there are no per-client rows: a legacy portal has
   * only the shared config, and an unsupported build must surface as such
   * instead of looking "starting" forever.
   */
  async collectStatuses(device: Device, client: ManagedClient): Promise<void> {
    if (device.wgListenPort === null) return;
    const mode = this.mode(device);
    let info: instance.VpnPortalInfo | undefined;
    let rawError: string | null = null;
    try {
      const response = await client.remote.getVpnPortalInfo(
        instanceIdFor(device.networkId, device.id),
      );
      info = response.vpnPortalInfo;
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error);
      this.options.logger.debug("WireGuard portal probe failed", {
        deviceId: device.id,
        mode,
        error: rawError,
      });
    }
    const snapshot = rawError
      ? {
          state: "error" as const,
          error: `the hub did not answer the WireGuard portal query: ${rawError}`.slice(0, 500),
          vpnType: null,
          connectedClients: 0,
          perClientClients: false,
          checkedAt: new Date().toISOString(),
        }
      : interpretPortalProbe(info, mode);
    const detectedMode: WireguardPortalMode =
      snapshot.perClientClients ? "per-client" : mode;
    const reportedState = withPortalSnapshot(
      device.reportedState,
      snapshot,
      detectedMode,
    );
    const previousSnapshot = readPortalSnapshot(device.reportedState);
    const snapshotChanged =
      previousSnapshot?.state !== snapshot.state ||
      previousSnapshot?.error !== snapshot.error ||
      previousSnapshot?.connectedClients !== snapshot.connectedClients ||
      previousSnapshot?.perClientClients !== snapshot.perClientClients ||
      (device.reportedState as Record<string, unknown>).wgPortalMode !== detectedMode;
    if (snapshotChanged) {
      await updateDevice(this.options.db, device.id, { reportedState });
      device.reportedState = reportedState;
    }

    if (detectedMode !== "per-client") {
      if (snapshotChanged) {
        this.publish(device.orgId, device.networkId, {
          hubDeviceId: device.id,
          reason: "status",
        });
      }
      return;
    }
    const rows = await listWireguardClientsForHub(this.options.db, device.id);
    if (rows.length === 0) {
      if (snapshotChanged) {
        this.publish(device.orgId, device.networkId, {
          hubDeviceId: device.id,
          reason: "status",
        });
      }
      return;
    }
    if (!info) return;
    const byName = new Map(
      portalStatuses(info).map((status) => [status.name, status]),
    );
    const now = new Date();
    let changed = false;
    const statuses: NonNullable<
      RealtimeEventData["wireguard.updated"]["statuses"]
    > = [];
    for (const row of rows) {
      const status = byName.get(row.name);
      if (!status) continue;
      const previous = statusRecord(row);
      const next = {
        state: status.state,
        endpoint: status.endpoint,
        tunnelIp: status.tunnelIp,
        peerId: status.peerId,
        error: status.error,
      };
      const same =
        previous.state === next.state &&
        previous.endpoint === next.endpoint &&
        previous.tunnelIp === next.tunnelIp &&
        previous.peerId === next.peerId &&
        previous.error === next.error;
      if (same) continue;
      await recordWireguardStatus(this.options.db, row.id, next, now);
      changed = true;
      statuses.push({
        clientId: row.id,
        ...next,
        statusAt: now.toISOString(),
      });
    }
    if (changed) {
      this.publish(device.orgId, device.networkId, {
        hubDeviceId: device.id,
        reason: "status",
        statuses,
      });
    }
  }

  private publish(
    orgId: string,
    networkId: string,
    input: {
      clientId?: string;
      hubDeviceId?: string;
      reason: string;
      statuses?: RealtimeEventData["wireguard.updated"]["statuses"];
    },
  ): void {
    const realtime = this.options.realtime;
    if (!realtime) return;
    realtime.publish({
      type: "wireguard.updated",
      orgId,
      networkId,
      data: {
        networkId,
        reason: input.reason,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.hubDeviceId ? { hubDeviceId: input.hubDeviceId } : {}),
        ...(input.statuses ? { statuses: input.statuses } : {}),
      },
    });
  }
}
