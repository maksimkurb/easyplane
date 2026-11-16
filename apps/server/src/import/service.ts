import { manage } from "@easyplane/proto";

import type { Database } from "../db/client.js";
import type { Device, Network } from "../db/schema.js";
import {
  getDeviceById,
  getNetworkById,
  listDevicesInNetwork,
} from "../db/repositories.js";
import type { DesiredConfig } from "../domain/desired-config.js";
import type { Logger } from "../logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { METRIC_NAMES } from "../observability/metrics.js";
import { randomToken } from "../security/crypto.js";
import type { DeviceSessionRegistry } from "../services/device-sessions.js";
import { AppError, conflict, invalid, notFound } from "../services/errors.js";
import type { NetworkDto, NetworkService } from "../services/network-service.js";
import { instanceIdFor } from "../services/push-service.js";
import {
  describeNetworkConfig,
  type ImportSummary,
  type ImportedNetworkSpec,
} from "./draft.js";
import { decodeShareLink } from "./share-link.js";
import { tomlToNetworkConfig } from "./toml.js";

export type ImportSourceInput =
  | { type: "toml"; text: string; name?: string }
  | { type: "shareLink"; link: string; name?: string }
  | { type: "device"; deviceId: string; instanceId?: string; name?: string };

export interface ImportPreviewOptions {
  /** Optional comparison target; never modified by an import. */
  existingNetworkId?: string;
  name?: string;
}

export interface ImportSecretPreview {
  present: boolean;
  /** null when there is no existing network to compare against. */
  sameAsExisting: boolean | null;
}

export interface ImportDiffEntry {
  field: string;
  current: string | null;
  incoming: string | null;
  changed: boolean;
}

/**
 * A raw peer URL of the imported config that exactly equals the advertised
 * endpoint of a device in the source network. The imported network keeps the
 * URL as a raw entry; linking it turns it device-backed and stops that device
 * from dialling itself. Suggestions are never applied automatically.
 */
export interface ImportPeerLink {
  url: string;
  deviceId: string;
  hostname: string;
}

export interface ImportPreview {
  draftId: string;
  expiresAt: string;
  source: { type: ImportSourceInput["type"]; detail: string };
  network: {
    name: string;
    networkName: string;
    ipv4Cidr: string;
    magicDnsEnabled: boolean;
    defaultConfig: DesiredConfig;
  };
  summary: ImportSummary;
  secret: ImportSecretPreview;
  diff: ImportDiffEntry[];
  warnings: string[];
  unsupported: string[];
  existingNetworkId: string | null;
  /** True when network_name already exists anywhere in this deployment. */
  networkNameTaken: boolean;
  /** Exact URL -> device matches worth linking after the import. */
  peerLinks: ImportPeerLink[];
}

export interface CommitImportInput {
  name?: string;
  ipv4Cidr?: string;
}

interface DraftRecord {
  id: string;
  orgId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  source: { type: ImportSourceInput["type"]; detail: string };
  spec: ImportedNetworkSpec;
  /** Config without the secret; the secret lives in `secret` only. */
  config: manage.NetworkConfig;
  secret: string;
  summary: ImportSummary;
  warnings: string[];
  unsupported: string[];
}

export const IMPORT_DRAFT_TTL_MS = 10 * 60_000;
const MAX_DRAFTS = 200;

/**
 * Short-lived, server-side drafts. Keeping the parsed config off the wire means
 * the admin's browser never receives the network secret just to save an import,
 * and the committed network is byte-identical to the previewed one. The store
 * is in-process, like the rest of M1–M3 state (see docs/DEPLOY.md §6).
 */
export class ImportDraftStore {
  private readonly drafts = new Map<string, DraftRecord>();

  constructor(
    private readonly ttlMs = IMPORT_DRAFT_TTL_MS,
    private readonly maxDrafts = MAX_DRAFTS,
  ) {}

  create(input: Omit<DraftRecord, "id" | "createdAt" | "expiresAt">): DraftRecord {
    this.purge();
    if (this.drafts.size >= this.maxDrafts) {
      const oldest = [...this.drafts.values()].sort(
        (left, right) => left.createdAt - right.createdAt,
      )[0];
      if (oldest) this.drafts.delete(oldest.id);
    }
    const now = Date.now();
    const draft: DraftRecord = {
      ...input,
      id: randomToken(24),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  /** Removes and returns a draft. Single use: a commit cannot be replayed. */
  take(id: string, orgId: string, userId: string): DraftRecord {
    const draft = this.drafts.get(id);
    if (!draft) invalid("import draft not found or already used");
    if (draft.orgId !== orgId || draft.userId !== userId) {
      // Do not confirm that somebody else's draft exists.
      notFound("import draft not found");
    }
    this.drafts.delete(id);
    if (draft.expiresAt <= Date.now()) {
      throw new AppError(410, "import draft expired", "draft_expired");
    }
    return draft;
  }

  get size(): number {
    return this.drafts.size;
  }

  purge(now = Date.now()): void {
    for (const [id, draft] of this.drafts) {
      if (draft.expiresAt <= now) this.drafts.delete(id);
    }
  }
}

export interface ImportServiceOptions {
  db: Database;
  networks: NetworkService;
  sessions: DeviceSessionRegistry;
  drafts?: ImportDraftStore;
  logger?: Logger;
  metrics?: MetricsRegistry;
}

function maskValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return null;
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

function flatten(
  prefix: string,
  value: unknown,
  output: Map<string, string>,
): void {
  if (value === undefined || value === null) return;
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      output.set(prefix, "{}");
      return;
    }
    for (const [key, entry] of entries) {
      flatten(prefix ? `${prefix}.${key}` : key, entry, output);
    }
    return;
  }
  output.set(prefix, JSON.stringify(value) ?? String(value));
}

function diffConfig(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): ImportDiffEntry[] {
  const left = new Map<string, string>();
  const right = new Map<string, string>();
  flatten("", current, left);
  flatten("", incoming, right);
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys]
    .sort()
    .map((key) => {
      const before = left.get(key) ?? null;
      const after = right.get(key) ?? null;
      return {
        field: key,
        current: maskValue(before === null ? null : JSON.parse(before)),
        incoming: maskValue(after === null ? null : JSON.parse(after)),
        changed: before !== after,
      };
    })
    .filter((entry) => entry.changed);
}

export class ImportService {
  readonly drafts: ImportDraftStore;

  constructor(private readonly options: ImportServiceOptions) {
    this.drafts = options.drafts ?? new ImportDraftStore();
  }

  async preview(
    orgId: string,
    userId: string,
    source: ImportSourceInput,
    options: ImportPreviewOptions = {},
  ): Promise<ImportPreview> {
    let config: manage.NetworkConfig;
    let warnings: string[] = [];
    let unsupported: string[] = [];
    let secret = "";
    let credentialMode = false;
    let detail: string;
    let suggestedName = options.name;
    let adoptedNetworkId: string | null = null;

    try {
      switch (source.type) {
      case "toml": {
        if (source.text.trim() === "") invalid("paste an EasyTier TOML config first");
        if (source.text.length > 512 * 1024) invalid("TOML config is too large (512 KiB max)");
        const parsed = tomlToNetworkConfig(source.text);
        config = parsed.config;
        warnings = parsed.warnings;
        unsupported = parsed.unsupported;
        credentialMode = parsed.credentialMode;
        secret = parsed.config.networkSecret ?? "";
        suggestedName = suggestedName ?? source.name;
        detail = `pasted TOML (${source.text.length} bytes)`;
        break;
      }
      case "shareLink": {
        if (source.link.length > 64 * 1024) invalid("share link is too long");
        const parsed = decodeShareLink(source.link);
        config = parsed.config;
        warnings = parsed.warnings;
        secret = parsed.config.networkSecret ?? "";
        credentialMode =
          Boolean(parsed.config.secureMode?.enabled) &&
          secret === "" &&
          Boolean(parsed.config.secureMode?.localPrivateKey);
        suggestedName = suggestedName ?? source.name ?? parsed.displayName;
        detail = `share link from ${describeLinkHost(source.link)}`;
        if (parsed.onlyStart) {
          warnings.push(
            'the link is marked "only start": the EasyTier client will not enable the instance automatically on boot',
          );
        }
        break;
      }
      case "device": {
        const adopted = await this.adoptFromDevice(orgId, source.deviceId, source.instanceId);
        config = adopted.config;
        warnings = adopted.warnings;
        unsupported = adopted.unsupported;
        secret = adopted.config.networkSecret ?? "";
        credentialMode =
          Boolean(adopted.config.secureMode?.enabled) &&
          secret === "" &&
          Boolean(adopted.config.secureMode?.localPrivateKey);
        suggestedName = suggestedName ?? adopted.device.hostname;
        adoptedNetworkId = adopted.device.networkId;
        detail = `device ${adopted.device.hostname || adopted.device.id} instance ${adopted.instanceId}`;
        break;
      }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      invalid(error instanceof Error ? error.message : "invalid import source");
    }

    if (secret === "" && config.credentialFile) {
      // A credential file is the client's identity; copying it as "no secret"
      // would create an open network that the original peers cannot join.
      credentialMode = true;
    }
    if (credentialMode) {
      // Adoption as a member is refused: the device's credential is issued by
      // an anchor of *this* network, and the private key in the imported config
      // is that device's identity, not a network. There is no way to verify
      // which network it belongs to without an anchor that already publishes
      // it, so silently turning it into a shared-secret network would either
      // break the chain or open the network. docs/CREDENTIALS.md §7.
      throw new AppError(
        422,
        "this config belongs to a device that joins with a per-device credential " +
          "(secure_mode.local_private_key or credential_file, no network_secret). " +
          "A credential is issued by an anchor of an existing credentials network and cannot be adopted as a network: " +
          "create the network, add this device as a member from the panel, and use the credential the panel issues.",
        "credential_mode_unsupported",
      );
    }

    let described;
    try {
      described = describeNetworkConfig(config, { suggestedName });
    } catch (error) {
      invalid(error instanceof Error ? error.message : "invalid network config");
    }
    warnings = [...warnings, ...described.warnings];
    // `describeConfig` reports workflow-owned fields; merge without duplicates.
    unsupported = [...new Set([...unsupported, ...described.unsupported])];

    // The secret must never reach the browser. Drop it from the normalised
    // config kept in the draft and compare it server-side only.
    const draftConfig: manage.NetworkConfig = { ...config, networkSecret: undefined };

    const existing = options.existingNetworkId
      ? await getNetworkById(this.options.db, options.existingNetworkId)
      : undefined;
    if (existing && existing.orgId !== orgId) notFound("network not found");

    const existingSecret = existing
      ? await this.revealSecretForCompare(existing)
      : null;

    const networkNameTaken = await this.networkNameExists(
      described.spec.networkName,
      orgId,
      existing?.id,
    );

    const secretSameAsExisting = existing
      ? existingSecret === secret
      : null;

    // Adopting from a device only *proposes* links: a raw peer URL that is
    // byte-identical to another device's advertised endpoint is very likely
    // that device, but the control plane never guesses from DNS or IPs.
    const peerLinks = adoptedNetworkId
      ? await this.suggestPeerLinks(
          orgId,
          adoptedNetworkId,
          described.spec.defaultConfig.peerUrls,
        )
      : [];
    if (peerLinks.length > 0) {
      warnings.push(
        `${peerLinks.length} peer URL(s) exactly match a device's advertised endpoint; ` +
          "link them to those devices on the network page so the device stops dialling itself",
      );
    }

    const diff: ImportDiffEntry[] = existing
      ? [
          {
            field: "name",
            current: existing.name,
            incoming: described.spec.name,
            changed: existing.name !== described.spec.name,
          },
          {
            field: "networkName",
            current: existing.networkName,
            incoming: described.spec.networkName,
            changed: existing.networkName !== described.spec.networkName,
          },
          {
            field: "ipv4Cidr",
            current: existing.ipv4Cidr,
            incoming: described.spec.ipv4Cidr,
            changed: existing.ipv4Cidr !== described.spec.ipv4Cidr,
          },
          {
            field: "magicDnsEnabled",
            current: String(existing.magicDnsEnabled),
            incoming: String(described.spec.magicDnsEnabled),
            changed: existing.magicDnsEnabled !== described.spec.magicDnsEnabled,
          },
          {
            field: "networkSecret",
            current: null,
            incoming: secretSameAsExisting ? "same" : "different",
            changed: !secretSameAsExisting,
          },
          ...diffConfig(
            existing.defaultConfig ?? {},
            described.spec.defaultConfig as unknown as Record<string, unknown>,
          ),
        ].filter((entry) => entry.changed || entry.field === "networkSecret")
      : [];

    if (existing) {
      warnings.push(
        "this import creates a new network; the selected existing network is only used for the diff and is not modified",
      );
    }
    if (networkNameTaken) {
      warnings.push(
        `network_name "${described.spec.networkName}" already exists in this deployment; the import will fail until it is changed`,
      );
    }
    if (!secret) {
      warnings.push(
        "the source has no network_secret (open network). Existing peers will keep working only if their configs also have no secret.",
      );
    }

    const draft = this.drafts.create({
      orgId,
      userId,
      source: { type: source.type, detail },
      spec: described.spec,
      config: draftConfig,
      secret,
      summary: described.summary,
      warnings,
      unsupported,
    });
    this.options.logger?.info("network import previewed", {
      userId,
      sourceType: source.type,
      networkName: described.spec.networkName,
      secretPresent: secret !== "",
      draftId: draft.id,
    });

    return {
      draftId: draft.id,
      expiresAt: new Date(draft.expiresAt).toISOString(),
      source: draft.source,
      network: {
        name: described.spec.name,
        networkName: described.spec.networkName,
        ipv4Cidr: described.spec.ipv4Cidr,
        magicDnsEnabled: described.spec.magicDnsEnabled,
        defaultConfig: described.spec.defaultConfig,
      },
      summary: described.summary,
      secret: { present: secret !== "", sameAsExisting: secretSameAsExisting },
      diff,
      warnings,
      unsupported,
      existingNetworkId: existing?.id ?? null,
      networkNameTaken,
      peerLinks,
    };
  }

  async commit(
    orgId: string,
    userId: string,
    draftId: string,
    input: CommitImportInput = {},
  ): Promise<NetworkDto> {
    const draft = this.drafts.take(draftId, orgId, userId);
    const name = (input.name ?? draft.spec.name).trim();
    const ipv4Cidr = (input.ipv4Cidr ?? draft.spec.ipv4Cidr).trim();
    const network = await this.options.networks.importNetwork({
      orgId,
      userId,
      name,
      networkName: draft.spec.networkName,
      secret: draft.secret,
      ipv4Cidr,
      defaultConfig: draft.spec.defaultConfig as unknown as Record<string, unknown>,
      magicDnsEnabled: draft.spec.magicDnsEnabled,
      source: draft.source.type,
    });
    this.options.metrics?.inc(METRIC_NAMES.imports, { source: draft.source.type });
    this.options.logger?.info("network imported", {
      userId,
      networkId: network.id,
      networkName: network.networkName,
      source: draft.source.type,
      sourceIdentityKept: draft.secret !== "",
    });
    return network;
  }

  /** Lists instances of a connected device that can be adopted. */
  async listDeviceInstances(
    orgId: string,
    deviceId: string,
  ): Promise<Array<{ instanceId: string; managed: boolean }>> {
    const device = await this.requireDevice(orgId, deviceId);
    const client = this.options.sessions.get(device.id);
    if (!client) throw conflict("device is offline");
    const instanceIds = await client.remote
      .listNetworkInstance()
      .catch((error: unknown) => {
        this.options.logger?.debug("listDeviceInstances RPC failed", {
          deviceId: device.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw conflict("the device did not answer ListNetworkInstance");
      });
    const managedId = instanceIdFor(device.networkId, device.id);
    return instanceIds.map((instanceId) => ({
      instanceId,
      managed: instanceId === managedId,
    }));
  }

  private async adoptFromDevice(
    orgId: string,
    deviceId: string,
    requestedInstanceId?: string,
  ): Promise<{
    device: Device;
    instanceId: string;
    config: manage.NetworkConfig;
    warnings: string[];
    unsupported: string[];
  }> {
    const device = await this.requireDevice(orgId, deviceId);
    const client = this.options.sessions.get(device.id);
    if (!client) {
      throw conflict(
        "device is offline; a device must be connected to read its running config",
      );
    }
    const instanceIds = await client.remote
      .listNetworkInstance()
      .catch((error: unknown) => {
        this.options.logger?.debug("adopt ListNetworkInstance RPC failed", {
          deviceId: device.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw conflict("the device did not answer ListNetworkInstance");
      });
    if (instanceIds.length === 0) {
      throw conflict("the device is connected but runs no EasyTier instance");
    }
    const managedId = instanceIdFor(device.networkId, device.id);
    let instanceId: string;
    if (requestedInstanceId) {
      if (!instanceIds.includes(requestedInstanceId)) {
        throw invalid(
          `the device does not run instance ${requestedInstanceId}; available: ${instanceIds.join(", ")}`,
        );
      }
      instanceId = requestedInstanceId;
    } else if (instanceIds.includes(managedId)) {
      instanceId = managedId;
    } else if (instanceIds.length === 1) {
      instanceId = instanceIds[0]!;
    } else {
      throw conflict(
        `the device runs ${instanceIds.length} instances; choose one explicitly`,
      );
    }

    const response = await client.remote
      .getNetworkInstanceConfig(instanceId)
      .catch((error: unknown) => {
        this.options.logger?.debug("adopt GetNetworkInstanceConfig RPC failed", {
          deviceId: device.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw conflict("the device did not return its running config");
      });
    if (!response.config) {
      throw conflict("the device returned no config for that instance");
    }
    const warnings = [
      "adopted from a running instance: the secret is preserved, device-specific values (instance id, hostname, address) are replaced by EasyPlane",
    ];
    const unsupported: string[] = [];
    if (response.source === manage.ConfigSource.ConfigSourceUser) {
      warnings.push("the instance is file/user configured on the client");
    }
    return {
      device,
      instanceId,
      config: response.config,
      warnings,
      unsupported,
    };
  }

  private async requireDevice(orgId: string, deviceId: string): Promise<Device> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device || device.orgId !== orgId) notFound("device not found");
    return device;
  }

  /** Exact string matches only; no DNS resolution and no IP comparison. */
  private async suggestPeerLinks(
    orgId: string,
    networkId: string,
    urls: readonly string[],
  ): Promise<ImportPeerLink[]> {
    if (urls.length === 0) return [];
    const devices = (await listDevicesInNetwork(this.options.db, networkId)).filter(
      (device) => device.orgId === orgId && device.state === "approved",
    );
    const byEndpoint = new Map<string, Device>();
    for (const device of devices) {
      for (const endpoint of device.advertisedEndpoints) {
        if (!byEndpoint.has(endpoint)) byEndpoint.set(endpoint, device);
      }
    }
    const links: ImportPeerLink[] = [];
    const seen = new Set<string>();
    for (const url of urls) {
      const device = byEndpoint.get(url);
      if (!device || seen.has(url)) continue;
      seen.add(url);
      links.push({
        url,
        deviceId: device.id,
        hostname: device.dnsName ?? device.hostname,
      });
    }
    return links;
  }

  private async revealSecretForCompare(network: Network): Promise<string | null> {
    try {
      // Compared in memory only; never returned and never audited as a reveal.
      return await this.options.networks.decryptSecretForComparison(network);
    } catch {
      return null;
    }
  }

  private async networkNameExists(
    networkName: string,
    orgId: string,
    excludeId?: string,
  ): Promise<boolean> {
    const row = await this.options.db.query.networks.findFirst({
      where: (table, { eq }) => eq(table.networkName, networkName),
    });
    if (!row) return false;
    return row.id !== excludeId && row.orgId === orgId;
  }
}

function describeLinkHost(input: string): string {
  if (!/^https?:\/\//i.test(input.trim())) return "a raw payload";
  try {
    return new URL(input.trim()).host;
  } catch {
    return "an invalid host";
  }
}
