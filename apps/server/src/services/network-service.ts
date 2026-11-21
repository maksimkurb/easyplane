import { randomBytes } from "node:crypto";

import type { DbExecutor } from "../db/repositories.js";
import {
  compactNetworkPeerPositions,
  deleteNetwork,
  getDeviceById,
  deleteNetworkPeer,
  getDevice,
  getNetwork,
  getNetworkPeer,
  insertNetwork,
  insertNetworkPeer,
  listDevicesInNetwork,
  listNetworkPeerRecords,
  listDeviceTags,
  listNetworks,
  networkDeviceCounts,
  nextNetworkPeerPosition,
  updateDevice,
  updateNetwork,
  updateNetworkPeer,
  usedVirtualIps,
} from "../db/repositories.js";
import type {
  Device,
  Network,
  NetworkAccessMode,
  NetworkPeer,
} from "../db/schema.js";
import type { RendezvousConfig } from "../env.js";
import type { Logger } from "../logger.js";
import { parseCidr } from "../domain/ip.js";
import { normalizeDnsZone } from "../domain/magic-dns.js";
import { normalizeDesiredConfig } from "../domain/desired-config.js";
import {
  dedupePeerUrls,
  isValidPeerUrl,
  peerUrlKey,
  validatePeerUrl,
} from "../domain/peers.js";
import {
  constantTimeEqual,
  generateNetworkSecret,
  slugify,
} from "../security/crypto.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { SecretBox } from "../security/crypto.js";
import type { AuditService } from "./audit.js";
import type {
  CredentialMigrationPlan,
  CredentialService,
} from "./credential-service.js";
import { AppError, conflict, invalid, notFound } from "./errors.js";

export interface NetworkDto {
  id: string;
  name: string;
  networkName: string;
  ipv4Cidr: string;
  defaultConfig: Record<string, unknown>;
  magicDnsEnabled: boolean;
  magicDnsZone: string;
  /** Effective policy version (0 while the access mode is open). */
  policyVersion: number;
  /** Access mode: open (no ACL pushed), rules or json. */
  policyMode: "open" | "rules" | "json";
  /** Devices in this network dial the bundled rendezvous node. */
  useRendezvous: boolean;
  /** Every device is pushed `p2p_only` (advanced; no relay fallback). */
  p2pOnly: boolean;
  /** Read-only credential/anchor state for the access-mode card. */
  access: NetworkAccessDto;
  /** Read-only bundled rendezvous state for this network. */
  rendezvous: NetworkRendezvousDto;
  /** What the compiled peer list can contain, for the "no dial target" warning. */
  peerPlan: NetworkPeerPlanDto;
  createdAt: string;
  updatedAt: string;
  deviceCounts: { pending: number; approved: number; blocked: number };
}

export interface NetworkRendezvousDto {
  /** At least one endpoint is configured on the server. */
  configured: boolean;
  useBundled: boolean;
  /**
   * Whether this network's secret equals the node's secret, when the panel has
   * `EASYPLANE_RENDEZVOUS_SECRET`. `null` means it cannot be checked here.
   */
  secretMatches: boolean | null;
  endpoints: string[];
  relayData: boolean;
  privateMode: boolean;
  networkName: string | null;
}

export interface NetworkAccessDto {
  mode: NetworkAccessMode;
  /** Approved anchors (hold the network secret). */
  anchors: number;
  /** Approved anchors that are online right now. */
  onlineAnchors: number;
  /** Approved members (credential networks only). */
  members: number;
  activeCredentials: number;
  /** Credentials that will be renewed in the next window. */
  expiringCredentials: number;
  /**
   * Machine-readable warnings the UI renders in the operator's language.
   * `no_anchor_online` is the important one: without an anchor no new member
   * can join through a rendezvous node.
   */
  warnings: Array<
    | "no_anchor"
    | "no_anchor_online"
    | "only_one_anchor"
    | "no_members"
    | "rendezvous_needs_anchor"
    | "credentials_expiring"
  >;
}

export interface NetworkPeerPlanDto {
  /** Distinct advertised endpoints of approved hubs in the peer list. */
  hubEndpoints: number;
  /** Raw external peer URLs in the list. */
  rawPeers: number;
  /** Rendezvous endpoints appended at push time (0 when the toggle is off). */
  rendezvousEndpoints: number;
  /** False means devices have nothing to dial unless they share a LAN. */
  hasPeerEndpoint: boolean;
}

/**
 * One entry of a network's ordered peer list. `kind` says whether the entry is
 * a device reference (its advertised endpoints are compiled in) or a raw
 * external URL. `suggestedDeviceId` is set for a raw URL that exactly equals a
 * known device's advertised endpoint — the UI offers to link it, which turns
 * the entry into a device-backed one and stops that device from dialling
 * itself.
 */
export interface NetworkPeerDto {
  id: string;
  networkId: string;
  position: number;
  kind: "device" | "external";
  url: string | null;
  deviceId: string | null;
  deviceHostname: string | null;
  deviceDnsName: string | null;
  deviceMachineId: string | null;
  deviceState: Device["state"] | null;
  deviceIsHub: boolean;
  /** Advertised endpoints of the referenced (or linked) device. */
  endpoints: string[];
  suggestedDeviceId: string | null;
  suggestedDeviceHostname: string | null;
  createdAt: string;
}

function toDto(
  network: Network,
  counts: { pending: number; approved: number; blocked: number },
  rendezvous: NetworkRendezvousDto,
  peerPlan: NetworkPeerPlanDto,
  access: NetworkAccessDto,
): NetworkDto {
  return {
    id: network.id,
    name: network.name,
    networkName: network.networkName,
    ipv4Cidr: network.ipv4Cidr,
    defaultConfig: network.defaultConfig,
    magicDnsEnabled: network.magicDnsEnabled,
    magicDnsZone: network.magicDnsZone,
    policyVersion: network.policyMode === "open" ? 0 : network.policyVersion,
    policyMode: network.policyMode,
    useRendezvous: network.useRendezvous,
    p2pOnly: network.p2pOnly,
    access,
    rendezvous,
    peerPlan,
    createdAt: network.createdAt.toISOString(),
    updatedAt: network.updatedAt.toISOString(),
    deviceCounts: counts,
  };
}

function toPeerDto(
  peer: NetworkPeer,
  device: Device | null,
  suggested: Device | null,
): NetworkPeerDto {
  return {
    id: peer.id,
    networkId: peer.networkId,
    position: peer.position,
    kind: peer.url === null ? "device" : "external",
    url: peer.url,
    deviceId: peer.deviceId,
    deviceHostname: device?.hostname ?? null,
    deviceDnsName: device?.dnsName ?? null,
    deviceMachineId: device?.machineId ?? null,
    deviceState: device?.state ?? null,
    deviceIsHub: device?.isHub ?? false,
    endpoints: device?.advertisedEndpoints ?? [],
    suggestedDeviceId: suggested?.id ?? null,
    suggestedDeviceHostname:
      suggested?.dnsName ?? suggested?.hostname ?? null,
    createdAt: peer.createdAt.toISOString(),
  };
}

export class NetworkService {
  constructor(
    private readonly db: DbExecutor,
    private readonly secretBox: SecretBox,
    private readonly audit: AuditService,
    private readonly rendezvous: RendezvousConfig,
    /** Live browser fan-out; optional so unit tests can omit it. */
    private readonly realtime?: RealtimeHub,
    /** Credential lifecycle; optional in unit tests. */
    private readonly credentials?: CredentialService,
    /** Online check for anchor warnings; defaults to "unknown/offline". */
    private readonly isDeviceOnline: (deviceId: string) => boolean = () => false,
    private readonly logger?: Logger,
  ) {}

  /** Read-only bundled rendezvous state, safe for every authenticated role. */
  rendezvousInfo(): NetworkRendezvousDto {
    return {
      configured: this.rendezvous.configured,
      useBundled: false,
      secretMatches: null,
      endpoints: [...this.rendezvous.endpoints],
      relayData: this.rendezvous.relayData,
      privateMode: this.rendezvous.privateMode,
      networkName: this.rendezvous.networkName,
    };
  }

  private rendezvousFor(network: Network): NetworkRendezvousDto {
    const secret = this.secretBox.decrypt(network.secretCiphertext);
    return {
      configured: this.rendezvous.configured,
      useBundled: network.useRendezvous,
      secretMatches:
        this.rendezvous.secret === null
          ? null
          : constantTimeEqual(secret, this.rendezvous.secret),
      endpoints: [...this.rendezvous.endpoints],
      relayData: this.rendezvous.relayData,
      privateMode: this.rendezvous.privateMode,
      networkName: this.rendezvous.networkName,
    };
  }

  private async peerPlanFor(network: Network): Promise<NetworkPeerPlanDto> {
    const records = await listNetworkPeerRecords(this.db, network.id);
    const endpoints = new Set<string>();
    let rawPeers = 0;
    for (const { peer, device } of records) {
      if (peer.url !== null) {
        rawPeers += 1;
        continue;
      }
      if (!device || device.state !== "approved" || !device.isHub) continue;
      for (const endpoint of device.advertisedEndpoints) {
        if (isValidPeerUrl(endpoint)) endpoints.add(peerUrlKey(endpoint));
      }
    }
    const rendezvousEndpoints = network.useRendezvous
      ? this.rendezvous.endpoints.length
      : 0;
    return {
      hubEndpoints: endpoints.size,
      rawPeers,
      rendezvousEndpoints,
      hasPeerEndpoint:
        endpoints.size + rawPeers + rendezvousEndpoints > 0,
    };
  }

  private async accessFor(network: Network): Promise<NetworkAccessDto> {
    const devices = await listDevicesInNetwork(this.db, network.id);
    const approved = devices.filter((device) => device.state === "approved");
    const anchors = approved.filter((device) => device.role === "anchor");
    const onlineAnchors = anchors.filter((device) =>
      this.isDeviceOnline(device.id),
    );
    const summary = this.credentials
      ? await this.credentials.anchorSummary(network.id)
      : { anchors: 0, members: 0, activeCredentials: 0, expiringSoon: 0 };
    const warnings: NetworkAccessDto["warnings"] = [];
    if (network.accessMode === "credentials") {
      if (anchors.length === 0) warnings.push("no_anchor");
      else if (onlineAnchors.length === 0) warnings.push("no_anchor_online");
      if (anchors.length === 1) warnings.push("only_one_anchor");
      if (summary.members === 0 && approved.length > 0) warnings.push("no_members");
      if (network.useRendezvous) warnings.push("rendezvous_needs_anchor");
      if (summary.expiringSoon > 0) warnings.push("credentials_expiring");
    }
    return {
      mode: network.accessMode,
      anchors: anchors.length,
      onlineAnchors: onlineAnchors.length,
      members: summary.members,
      activeCredentials: summary.activeCredentials,
      expiringCredentials: summary.expiringSoon,
      warnings,
    };
  }

  private async dto(
    network: Network,
    counts: { pending: number; approved: number; blocked: number },
  ): Promise<NetworkDto> {
    const [peerPlan, access] = await Promise.all([
      this.peerPlanFor(network),
      this.accessFor(network),
    ]);
    return toDto(network, counts, this.rendezvousFor(network), peerPlan, access);
  }

  async create(input: {
    orgId: string;
    userId: string;
    name: string;
    ipv4Cidr?: string;
    defaultConfig?: Record<string, unknown>;
  }): Promise<NetworkDto> {
    const name = input.name.trim();
    if (name.length < 1) invalid("network name is required");
    const ipv4Cidr = input.ipv4Cidr ?? "10.144.144.0/24";
    try {
      parseCidr(ipv4Cidr);
    } catch (error) {
      invalid(error instanceof Error ? error.message : "invalid CIDR");
    }
    const defaults = normalizeDesiredConfig(input.defaultConfig ?? {});
    const peerUrls = this.validatedPeerUrls(defaults.peerUrls);
    const base = slugify(name) || "network";
    const networkName = `${base}-${randomBytes(3).toString("hex")}`;
    const secret = generateNetworkSecret();
    const network = await insertNetwork(this.db, {
      orgId: input.orgId,
      name,
      networkName,
      secretCiphertext: this.secretBox.encrypt(secret),
      ipv4Cidr,
      defaultConfig: defaults,
      createdBy: input.userId,
    });
    await this.seedRawPeers(network.id, input.orgId, input.userId, peerUrls);
    await this.audit.record({
      orgId: input.orgId,
      actorUserId: input.userId,
      action: "network.created",
      targetType: "network",
      targetId: network.id,
      metadata: { name, networkName, ipv4Cidr },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId: input.orgId,
      networkId: network.id,
      data: { networkId: network.id, reason: "created" },
    });
    return this.dto(network, { pending: 0, approved: 0, blocked: 0 });
  }

  /**
   * Creates a network from an imported EasyTier config. Unlike `create`, the
   * `network_name` and `network_secret` come from the source and must be
   * preserved byte-for-byte, otherwise existing peers cannot join. The secret
   * is still sealed with AES-256-GCM before it touches the database.
   */
  async importNetwork(input: {
    orgId: string;
    userId: string;
    name: string;
    networkName: string;
    secret: string;
    ipv4Cidr: string;
    defaultConfig: Record<string, unknown>;
    magicDnsEnabled: boolean;
    source: string;
  }): Promise<NetworkDto> {
    const name = input.name.trim();
    if (name.length < 1) invalid("network name is required");
    const networkName = input.networkName.trim();
    if (networkName.length < 1 || networkName.length > 128) {
      invalid("network_name must be 1..128 characters");
    }
    try {
      parseCidr(input.ipv4Cidr);
    } catch (error) {
      invalid(error instanceof Error ? error.message : "invalid CIDR");
    }
    const defaults = normalizeDesiredConfig(input.defaultConfig);
    const peerUrls = this.validatedPeerUrls(defaults.peerUrls);
    const duplicate = await this.db.query.networks.findFirst({
      where: (table, { eq }) => eq(table.networkName, networkName),
    });
    if (duplicate) {
      conflict(
        `a network with network_name "${networkName}" already exists in this deployment`,
      );
    }
    const network = await insertNetwork(this.db, {
      orgId: input.orgId,
      name,
      networkName,
      secretCiphertext: this.secretBox.encrypt(input.secret),
      ipv4Cidr: input.ipv4Cidr,
      defaultConfig: defaults,
      createdBy: input.userId,
    });
    await this.seedRawPeers(network.id, input.orgId, input.userId, peerUrls);
    if (input.magicDnsEnabled) {
      await updateNetwork(this.db, network.id, { magicDnsEnabled: true });
      network.magicDnsEnabled = true;
    }
    await this.audit.record({
      orgId: input.orgId,
      actorUserId: input.userId,
      action: "network.imported",
      targetType: "network",
      targetId: network.id,
      metadata: {
        name,
        networkName,
        ipv4Cidr: input.ipv4Cidr,
        source: input.source,
        sourceIdentityKept: input.secret !== "",
      },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId: input.orgId,
      networkId: network.id,
      data: { networkId: network.id, reason: "imported" },
    });
    return this.dto(network, { pending: 0, approved: 0, blocked: 0 });
  }

  async list(orgId: string): Promise<NetworkDto[]> {
    const networks = await listNetworks(this.db, orgId);
    return Promise.all(
      networks.map(async (network) =>
        this.dto(network, await networkDeviceCounts(this.db, network.id)),
      ),
    );
  }

  async get(orgId: string, id: string): Promise<NetworkDto> {
    const network = await getNetwork(this.db, orgId, id);
    if (!network) notFound("network not found");
    return this.dto(network, await networkDeviceCounts(this.db, network.id));
  }

  /** The organisation's first network, for org-scoped collections (tags). */
  async firstNetwork(orgId: string): Promise<Network | undefined> {
    const networks = await listNetworks(this.db, orgId);
    return networks[0];
  }

  async requireNetwork(orgId: string, id: string): Promise<Network> {
    const network = await getNetwork(this.db, orgId, id);
    if (!network) notFound("network not found");
    return network;
  }

  // -------------------------------------------------------------------------
  // Peer list (device-backed hubs + raw external URLs)
  // -------------------------------------------------------------------------

  async listPeers(orgId: string, networkId: string): Promise<NetworkPeerDto[]> {
    await this.requireNetwork(orgId, networkId);
    return this.peersFor(networkId);
  }

  private async peersFor(networkId: string): Promise<NetworkPeerDto[]> {
    const [records, devices] = await Promise.all([
      listNetworkPeerRecords(this.db, networkId),
      listDevicesInNetwork(this.db, networkId),
    ]);
    // Exact string match only: never resolve DNS or compare IPs. A raw URL can
    // therefore be linked to the device that advertised exactly that URL.
    const suggestions = new Map<string, Device>();
    for (const device of devices) {
      if (device.state !== "approved") continue;
      for (const endpoint of device.advertisedEndpoints) {
        if (!suggestions.has(endpoint)) suggestions.set(endpoint, device);
      }
    }
    return records.map(({ peer, device }) =>
      toPeerDto(peer, device, peer.url ? (suggestions.get(peer.url) ?? null) : null),
    );
  }

  /** Admin action: adds a device-backed hub entry or a raw external URL. */
  async addPeer(
    orgId: string,
    userId: string,
    networkId: string,
    input: { deviceId?: string; url?: string; linkedDeviceId?: string },
  ): Promise<NetworkPeerDto> {
    await this.requireNetwork(orgId, networkId);
    if ((input.url === undefined) === (input.deviceId === undefined)) {
      invalid("provide exactly one of deviceId (device-backed) or url (external)");
    }
    const records = await listNetworkPeerRecords(this.db, networkId);
    const position = await nextNetworkPeerPosition(this.db, networkId);
    let created: NetworkPeerDto | undefined;

    if (input.url !== undefined) {
      const url = this.validatedPeerUrl(input.url);
      const linked = input.linkedDeviceId
        ? await this.requireDeviceInNetwork(orgId, networkId, input.linkedDeviceId)
        : null;
      const duplicate = records.find(
        ({ peer }) => peer.url !== null && peerUrlKey(peer.url) === peerUrlKey(url),
      );
      if (duplicate) conflict("this peer URL is already in the network peer list");
      const peer = await insertNetworkPeer(this.db, {
        orgId,
        networkId,
        deviceId: linked?.id ?? null,
        url,
        position,
        createdBy: userId,
      });
      created = toPeerDto(peer, linked, null);
      await this.audit.record({
        orgId,
        actorUserId: userId,
        action: "network.peer_added",
        targetType: "network",
        targetId: networkId,
        metadata: {
          peerId: peer.id,
          kind: "external",
          url,
          linkedDeviceId: linked?.id ?? null,
        },
      });
    } else {
      const device = await this.requireDeviceInNetwork(
        orgId,
        networkId,
        input.deviceId!,
      );
      const duplicate = records.find(
        ({ peer }) => peer.url === null && peer.deviceId === device.id,
      );
      if (duplicate) {
        conflict("this device is already a network peer; edit it instead");
      }
      const peer = await insertNetworkPeer(this.db, {
        orgId,
        networkId,
        deviceId: device.id,
        url: null,
        position,
        createdBy: userId,
      });
      created = toPeerDto(peer, device, null);
      await this.audit.record({
        orgId,
        actorUserId: userId,
        action: "network.peer_added",
        targetType: "network",
        targetId: networkId,
        metadata: {
          peerId: peer.id,
          kind: "device",
          deviceId: device.id,
          endpoints: device.advertisedEndpoints,
        },
      });
    }

    this.realtime?.publish({
      type: "network.updated",
      orgId,
      networkId,
      data: { networkId, reason: "peer-added" },
    });
    return created;
  }

  /**
   * Converts a raw external entry into a device-backed one. The URL is added to
   * the device's advertised endpoints when it is missing, so the endpoint stays
   * reachable for other devices while the owning device stops receiving it.
   * If the device already has a device-backed entry the two rows are merged.
   */
  async linkPeer(
    orgId: string,
    userId: string,
    networkId: string,
    peerId: string,
    deviceId: string,
  ): Promise<NetworkPeerDto> {
    await this.requireNetwork(orgId, networkId);
    const peer = await getNetworkPeer(this.db, orgId, networkId, peerId);
    if (!peer) notFound("peer not found");
    if (peer.url === null) invalid("this peer is already device-backed");
    const device = await this.requireDeviceInNetwork(orgId, networkId, deviceId);
    const url = peer.url;
    const endpoints = device.advertisedEndpoints.some(
      (endpoint) => peerUrlKey(endpoint) === peerUrlKey(url),
    )
      ? device.advertisedEndpoints
      : dedupePeerUrls([...device.advertisedEndpoints, url]);
    const updatedDevice = await updateDevice(this.db, device.id, {
      advertisedEndpoints: endpoints,
      // A linked device must stay in the compiled list for every other
      // device; without the hub flag the converted entry would contribute
      // nothing and the endpoint would silently disappear.
      isHub: true,
    });
    if (!updatedDevice) throw new AppError(500, "failed to update the device");

    const records = await listNetworkPeerRecords(this.db, networkId);
    const existing = records.find(
      (record) =>
        record.peer.id !== peer.id &&
        record.peer.url === null &&
        record.peer.deviceId === device.id,
    );
    let linked;
    if (existing) {
      await deleteNetworkPeer(this.db, peer.id);
      await compactNetworkPeerPositions(this.db, networkId);
      linked = existing.peer;
    } else {
      const updated = await updateNetworkPeer(this.db, peer.id, {
        url: null,
        deviceId: device.id,
      });
      if (!updated) throw new AppError(500, "failed to link the peer");
      linked = updated;
    }
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.peer_linked",
      targetType: "network",
      targetId: networkId,
      metadata: {
        peerId: linked.id,
        previousUrl: url,
        deviceId: device.id,
        endpoints,
        hubEnabled: true,
        mergedIntoExisting: Boolean(existing),
      },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId,
      networkId,
      data: { networkId, reason: "peer-linked" },
    });
    return toPeerDto(linked, updatedDevice, null);
  }

  async removePeer(
    orgId: string,
    userId: string,
    networkId: string,
    peerId: string,
  ): Promise<void> {
    await this.requireNetwork(orgId, networkId);
    const peer = await getNetworkPeer(this.db, orgId, networkId, peerId);
    if (!peer) notFound("peer not found");
    await deleteNetworkPeer(this.db, peer.id);
    if (peer.url === null && peer.deviceId) {
      // Keep device-backed entries and the hub flag in sync.
      await updateDevice(this.db, peer.deviceId, { isHub: false });
    }
    await compactNetworkPeerPositions(this.db, networkId);
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.peer_removed",
      targetType: "network",
      targetId: networkId,
      metadata: {
        peerId: peer.id,
        deviceId: peer.deviceId,
        url: peer.url,
      },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId,
      networkId,
      data: { networkId, reason: "peer-removed" },
    });
  }

  private async requireDeviceInNetwork(
    orgId: string,
    networkId: string,
    deviceId: string,
  ): Promise<Device> {
    const device = await getDevice(this.db, orgId, deviceId);
    if (!device || device.networkId !== networkId) notFound("device not found");
    return device;
  }

  private validatedPeerUrl(value: string): string {
    try {
      return validatePeerUrl(value);
    } catch (error) {
      invalid(error instanceof Error ? error.message : "invalid peer URL");
    }
  }

  private validatedPeerUrls(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const value of values) {
      const url = this.validatedPeerUrl(value);
      const key = peerUrlKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
    }
    return urls;
  }

  /** Raw entries for legacy/imported peer URLs, in their original order. */
  private async seedRawPeers(
    networkId: string,
    orgId: string,
    userId: string | null,
    urls: readonly string[],
  ): Promise<void> {
    for (let position = 0; position < urls.length; position += 1) {
      await insertNetworkPeer(this.db, {
        orgId,
        networkId,
        deviceId: null,
        url: urls[position]!,
        position,
        createdBy: userId,
      });
    }
  }

  /** Admin-only: returns the plaintext secret and records the reveal. */
  async revealSecret(orgId: string, userId: string, id: string): Promise<string> {
    const network = await this.requireNetwork(orgId, id);
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.secret_revealed",
      targetType: "network",
      targetId: id,
    });
    return this.secretBox.decrypt(network.secretCiphertext);
  }

  /**
   * Decrypts a secret for an internal comparison (import preview, export).
   * Never returns to a browser without an explicit admin action and never
   * writes the plaintext anywhere.
   */
  async decryptSecretForComparison(network: Network): Promise<string> {
    return this.secretBox.decrypt(network.secretCiphertext);
  }

  async update(
    orgId: string,
    userId: string,
    id: string,
    values: {
      name?: string;
      ipv4Cidr?: string;
      magicDnsEnabled?: boolean;
      magicDnsZone?: string;
      useRendezvous?: boolean;
      p2pOnly?: boolean;
    },
  ): Promise<NetworkDto> {
    const network = await this.requireNetwork(orgId, id);
    if (values.useRendezvous === true && !this.rendezvous.configured) {
      conflict(
        "no bundled rendezvous node is configured; set EASYPLANE_RENDEZVOUS_ENDPOINTS first",
      );
    }
    if (
      values.useRendezvous === true &&
      network.useRendezvous !== true &&
      this.rendezvous.secret !== null &&
      !constantTimeEqual(
        this.secretBox.decrypt(network.secretCiphertext),
        this.rendezvous.secret,
      )
    ) {
      conflict(
        "this network's secret does not match the bundled rendezvous node's secret; " +
          "align the secret first or run a node with this network's secret",
      );
    }
    if (values.ipv4Cidr !== undefined && values.ipv4Cidr !== network.ipv4Cidr) {
      const used = await usedVirtualIps(this.db, id);
      const cidr = parseCidr(values.ipv4Cidr);
      const base = BigInt(cidr.base);
      for (const ip of used) {
        const parts = ip.split(".").map(Number);
        if (parts.length !== 4) continue;
        const value =
          ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
        if (value < base || value >= base + BigInt(cidr.size)) {
          conflict(
            "the new CIDR does not contain every address already allocated in this network",
          );
        }
      }
    }
    let zone: string | undefined;
    if (values.magicDnsZone !== undefined) {
      try {
        zone = normalizeDnsZone(values.magicDnsZone);
      } catch (error) {
        invalid(error instanceof Error ? error.message : "invalid DNS zone");
      }
    }
    const dnsChanged =
      (values.magicDnsEnabled !== undefined &&
        values.magicDnsEnabled !== network.magicDnsEnabled) ||
      (zone !== undefined && zone !== network.magicDnsZone);
    const rendezvousChanged =
      values.useRendezvous !== undefined &&
      values.useRendezvous !== network.useRendezvous;
    const p2pChanged =
      values.p2pOnly !== undefined && values.p2pOnly !== network.p2pOnly;
    const updated = await updateNetwork(this.db, id, {
      ...(values.name !== undefined ? { name: values.name.trim() } : {}),
      ...(values.ipv4Cidr !== undefined ? { ipv4Cidr: values.ipv4Cidr } : {}),
      ...(values.magicDnsEnabled !== undefined
        ? { magicDnsEnabled: values.magicDnsEnabled }
        : {}),
      ...(zone !== undefined ? { magicDnsZone: zone } : {}),
      ...(values.useRendezvous !== undefined
        ? { useRendezvous: values.useRendezvous }
        : {}),
      ...(values.p2pOnly !== undefined ? { p2pOnly: values.p2pOnly } : {}),
    });
    if (!updated) notFound("network not found");
    const action = rendezvousChanged
      ? "network.rendezvous_updated"
      : p2pChanged
        ? "network.p2p_updated"
        : dnsChanged
          ? "network.magicdns_updated"
          : "network.updated";
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action,
      targetType: "network",
      targetId: id,
      metadata: {
        changed: Object.keys(values),
        ...(dnsChanged
          ? {
              magicDnsEnabled: updated.magicDnsEnabled,
              magicDnsZone: updated.magicDnsZone,
            }
          : {}),
        ...(rendezvousChanged
          ? {
              useRendezvous: updated.useRendezvous,
              endpoints: updated.useRendezvous
                ? this.rendezvous.endpoints
                : [],
            }
          : {}),
        ...(p2pChanged ? { p2pOnly: updated.p2pOnly } : {}),
      },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId,
      networkId: id,
      data: {
        networkId: id,
        reason: rendezvousChanged
          ? "rendezvous-updated"
          : p2pChanged
            ? "p2p-updated"
            : "updated",
      },
    });
    return this.dto(updated, await networkDeviceCounts(this.db, id));
  }

  /**
   * Sets this network's EasyTier secret to the bundled rendezvous node's
   * secret, so its devices can use the node's private mode. The value comes
   * from `EASYPLANE_RENDEZVOUS_SECRET`; it is never returned. Devices are
   * repushed by the route (the new secret is part of every config).
   */
  async alignRendezvousSecret(
    orgId: string,
    userId: string,
    id: string,
  ): Promise<NetworkDto> {
    const network = await this.requireNetwork(orgId, id);
    if (this.rendezvous.secret === null) {
      conflict(
        "EASYPLANE_RENDEZVOUS_SECRET is not set, so the panel cannot align the secret",
      );
    }
    const updated = await updateNetwork(this.db, id, {
      secretCiphertext: this.secretBox.encrypt(this.rendezvous.secret),
    });
    if (!updated) notFound("network not found");
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.rendezvous_secret_aligned",
      targetType: "network",
      targetId: id,
      metadata: {
        // The secret itself is never written to the audit log.
        networkName: network.networkName,
      },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId,
      networkId: id,
      data: { networkId: id, reason: "rendezvous-secret-aligned" },
    });
    return this.dto(updated, await networkDeviceCounts(this.db, id));
  }

  /**
   * Guided migration between access modes (docs/CREDENTIALS.md).
   *
   * `shared_secret -> credentials`: the chosen devices stay anchors (they keep
   * the secret); every other approved device becomes a member and receives a
   * fresh credential. The preview lists exactly who gains/loses the secret and
   * warns about the first-anchor rule and the rendezvous dependency.
   *
   * `credentials -> shared_secret`: every device gains the network secret,
   * which is the largest possible blast radius; all credentials are revoked
   * but the keys that were already deployed cannot be unlearnt.
   */
  async previewAccessMode(input: {
    orgId: string;
    networkId: string;
    targetMode: NetworkAccessMode;
    anchorDeviceIds?: readonly string[];
  }): Promise<CredentialMigrationPlan> {
    const network = await this.requireNetwork(input.orgId, input.networkId);
    if (!this.credentials) {
      conflict("credential support is not available in this deployment");
    }
    return this.credentials.previewMigration({
      network,
      targetMode: input.targetMode,
      anchorDeviceIds: input.anchorDeviceIds,
    });
  }

  async switchAccessMode(input: {
    orgId: string;
    userId: string;
    networkId: string;
    targetMode: NetworkAccessMode;
    anchorDeviceIds?: readonly string[];
    acknowledge?: boolean;
  }): Promise<{ network: NetworkDto; plan: CredentialMigrationPlan }> {
    const network = await this.requireNetwork(input.orgId, input.networkId);
    if (!this.credentials) {
      conflict("credential support is not available in this deployment");
    }
    if (network.accessMode === input.targetMode) {
      // Re-running the switch is the documented repair path: a previous run
      // that failed after flipping the mode leaves some members without a
      // credential, and this issues what is missing.
      if (input.targetMode === "credentials") {
        const approved = await listDevicesInNetwork(this.db, network.id);
        for (const device of approved) {
          if (device.state !== "approved" || device.role !== "member") continue;
          try {
            await this.credentials.issueForDevice({
              network,
              device,
              userId: input.userId,
              reason: "access mode repair",
            });
          } catch (error) {
            this.logIssueFailure(network.id, device.id, error);
          }
        }
      }
      const plan = await this.credentials.previewMigration({
        network,
        targetMode: input.targetMode,
        anchorDeviceIds: input.anchorDeviceIds,
      });
      return {
        network: await this.dto(
          network,
          await networkDeviceCounts(this.db, network.id),
        ),
        plan,
      };
    }
    const plan = await this.credentials.previewMigration({
      network,
      targetMode: input.targetMode,
      anchorDeviceIds: input.anchorDeviceIds,
    });
    if (input.targetMode === "shared_secret" && !input.acknowledge) {
      conflict(
        "switching back to a shared secret gives every device the network secret. " +
          "Repeat with acknowledge=true to confirm.",
      );
    }
    const updated = await updateNetwork(this.db, network.id, {
      accessMode: input.targetMode,
    });
    if (!updated) notFound("network not found");
    const approved = await listDevicesInNetwork(this.db, network.id);
    const anchorIds = new Set(plan.anchors.map((anchor) => anchor.deviceId));

    if (input.targetMode === "credentials") {
      for (const device of approved) {
        if (device.state !== "approved") continue;
        const role = anchorIds.has(device.id) ? "anchor" : "member";
        if (device.role === role) continue;
        await updateDevice(this.db, device.id, { role });
        if (role === "anchor") {
          // A promoted device holds the secret now; the key is not needed.
          await this.credentials.revokeForDevice({
            orgId: input.orgId,
            userId: input.userId,
            deviceId: device.id,
            reason: "access mode switched to credentials: device is an anchor",
          });
        }
      }
      const members = await listDevicesInNetwork(this.db, network.id);
      const tagsByDevice = new Map<string, string[]>();
      for (const row of await listDeviceTags(this.db, input.orgId)) {
        const list = tagsByDevice.get(row.deviceId) ?? [];
        list.push(row.tagName);
        tagsByDevice.set(row.deviceId, list);
      }
      for (const device of members) {
        if (device.state !== "approved" || device.role !== "member") continue;
        try {
          await this.credentials.issueForDevice({
            network: updated,
            device,
            userId: input.userId,
            reason: "access mode switched to credentials",
            tags: tagsByDevice.get(device.id) ?? [],
          });
        } catch (error) {
          // One failed key must not abort the migration; the retry path above
          // issues what is missing, and the device shows a push error.
          this.logIssueFailure(network.id, device.id, error);
        }
      }
    } else {
      await this.credentials.revokeAllForNetwork({
        network: updated,
        userId: input.userId,
        reason: "access mode switched back to a shared secret",
      });
    }

    await this.audit.record({
      orgId: input.orgId,
      actorUserId: input.userId,
      action: "network.access_mode_changed",
      targetType: "network",
      targetId: network.id,
      metadata: {
        from: network.accessMode,
        to: input.targetMode,
        anchors: plan.anchors.map((anchor) => anchor.deviceId),
        members: plan.members.length,
        revokedCredentials: plan.revokeCredentials,
        warnings: plan.warnings,
        acknowledged: Boolean(input.acknowledge),
      },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId: input.orgId,
      networkId: network.id,
      data: { networkId: network.id, reason: "access-mode-changed" },
    });
    return {
      network: await this.dto(updated, await networkDeviceCounts(this.db, network.id)),
      plan,
    };
  }

  /**
   * Changes one device's role in a credentials network. See
   * CredentialService.setRole for the anchor→member caveat.
   */
  async setDeviceRole(input: {
    orgId: string;
    userId: string;
    networkId: string;
    deviceId: string;
    role: "anchor" | "member";
    acknowledge?: boolean;
  }): Promise<{ device: Device; needsSecretRotation: boolean }> {
    const network = await this.requireNetwork(input.orgId, input.networkId);
    if (!this.credentials) {
      conflict("credential support is not available in this deployment");
    }
    const device = await getDeviceById(this.db, input.deviceId);
    if (!device || device.networkId !== network.id) notFound("device not found");
    const result = await this.credentials.setRole({
      network,
      device,
      userId: input.userId,
      role: input.role,
      acknowledge: input.acknowledge,
    });
    const updated = await getDeviceById(this.db, input.deviceId);
    if (!updated) notFound("device not found");
    this.realtime?.publish({
      type: "network.updated",
      orgId: input.orgId,
      networkId: network.id,
      data: { networkId: network.id, reason: "device-role-changed" },
    });
    return { device: updated, needsSecretRotation: result.needsSecretRotation };
  }

  /** Logs a per-device migration failure without aborting the migration. */
  private logIssueFailure(
    networkId: string,
    deviceId: string,
    error: unknown,
  ): void {
    this.logger?.warn("credential issue failed during access-mode migration", {
      networkId,
      deviceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Names MagicDNS should answer for this network, from the control plane's
   * point of view. EasyTier itself derives records from peer hostnames, so this
   * table is what operators expect and what the device names are validated
   * against.
   */
  async resolvedNames(
    orgId: string,
    id: string,
  ): Promise<
    Array<{
      deviceId: string;
      hostname: string;
      zone: string;
      fqdn: string;
      ipv4: string | null;
      state: "pending" | "approved" | "blocked";
      reportedHostname: string;
      /** True when the client's own hostname differs from the DNS name. */
      renamed: boolean;
    }>
  > {
    const network = await this.requireNetwork(orgId, id);
    const devices = await listDevicesInNetwork(this.db, id);
    return devices
      .filter((device) => device.dnsName && device.virtualIpv4)
      .map((device) => ({
        deviceId: device.id,
        hostname: device.dnsName ?? "",
        zone: network.magicDnsZone,
        fqdn: `${device.dnsName}.${network.magicDnsZone}`,
        ipv4: device.virtualIpv4,
        state: device.state,
        reportedHostname: device.hostname,
        renamed:
          device.hostname !== "" &&
          device.hostname.toLowerCase() !== (device.dnsName ?? "").toLowerCase(),
      }))
      .sort(
        (left, right) =>
          left.fqdn.localeCompare(right.fqdn) ||
          left.deviceId.localeCompare(right.deviceId),
      );
  }

  async delete(orgId: string, userId: string, id: string): Promise<void> {
    const network = await this.requireNetwork(orgId, id);
    await deleteNetwork(this.db, id);
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.deleted",
      targetType: "network",
      targetId: id,
      metadata: { name: network.name },
    });
    this.realtime?.publish({
      type: "network.deleted",
      orgId,
      networkId: id,
      data: { networkId: id },
    });
  }

  async regenerateSecret(
    orgId: string,
    userId: string,
    id: string,
  ): Promise<string> {
    const network = await this.requireNetwork(orgId, id);
    if (network.useRendezvous) {
      conflict(
        "this network uses the bundled rendezvous node and the node only admits its own secret. " +
          "Turn 'Use bundled rendezvous node' off (or rotate the node secret and re-align) before rotating this network's secret.",
      );
    }
    const secret = generateNetworkSecret();
    const updated = await updateNetwork(this.db, id, {
      secretCiphertext: this.secretBox.encrypt(secret),
    });
    if (!updated) throw new AppError(500, "failed to update network");
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "network.secret_rotated",
      targetType: "network",
      targetId: id,
      metadata: { networkName: network.networkName },
    });
    this.realtime?.publish({
      type: "network.updated",
      orgId,
      networkId: id,
      data: { networkId: id, reason: "secret-rotated" },
    });
    return secret;
  }
}
