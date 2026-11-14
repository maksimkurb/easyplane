import { acl } from "@easyplane/proto";

import type { DbExecutor } from "../db/repositories.js";
import {
  getNetworkById,
  getNetworkPolicyVersion,
  insertNetworkPolicy,
  insertRevision,
  listDeviceTags,
  listDevicesForReconcile,
  listNetworkPolicies,
  listRevisions,
  listTags,
  upsertTag,
  listUsers,
  updateDevice,
  updateNetwork,
} from "../db/repositories.js";
import type { Device, Network, User, UserRole } from "../db/schema.js";
import { normalizeDesiredConfig } from "../domain/desired-config.js";
import {
  PolicyValidationError,
  compilePolicy,
  describePolicy,
  evaluateCidrReachability,
  evaluateReachability,
  parsePolicyText,
  resolvePolicy,
  SubjectResolutionError,
  type CompileResult,
  type PolicyDevice,
  type PolicyDocument,
  type PolicyRouteInput,
  type PolicyUser,
  type ReachabilityResult,
} from "../domain/policy/index.js";
import { canonicalAcl } from "../domain/policy/canonical.js";
import { approvedRoutesForNetwork } from "../db/repositories.js";
import { cidrPrefix } from "../domain/ip.js";
import { nextRevisionNumber } from "../domain/revisions.js";
import type { SecretBox } from "../security/crypto.js";
import { AppError, invalid, notFound } from "./errors.js";
import type { AuditService } from "./audit.js";
import type { PushService } from "./push-service.js";
import type { RequestActor } from "./device-service.js";

export interface PolicyVersionDto {
  id: string;
  networkId: string;
  version: number;
  document: Record<string, unknown>;
  note: string;
  createdBy: string | null;
  createdAt: string;
  /** Compact summary for the versions table. */
  summary: {
    statements: number;
    tags: string[];
    groups: string[];
    hosts: string[];
    strictTags: boolean;
  };
}

export interface CompiledAclSummary {
  deviceId: string;
  hostname: string;
  inboundRules: number;
  outboundRules: number;
  forwardRules: number;
  declaredGroups: string[];
  /** Canonical ACL hash, useful to see which devices share a compilation. */
  hash: string;
}

export interface PreviewResult {
  warnings: string[];
  devices: CompiledAclSummary[];
  reachability: {
    allowed: boolean;
    egress: { action: string; matchedRule: string | null };
    ingress: { action: string; matchedRule: string | null };
    explanation: string[];
  };
}

export interface PolicyServiceOptions {
  db: DbExecutor;
  secretBox: SecretBox;
  audit: AuditService;
  push: PushService;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Policy source of truth: versioned documents, the compiled per-device ACL,
 * and the reachability preview. Secrets never enter the database: EasyTier
 * group secrets are derived from `EASYPLANE_ENCRYPTION_KEY` and the network id.
 */
export class PolicyService {
  constructor(private readonly options: PolicyServiceOptions) {}

  private get db(): DbExecutor {
    return this.options.db;
  }

  /** EasyTier group secret for `tag` inside `networkId`. */
  groupSecret(networkId: string, tag: string): string {
    return this.options.secretBox.derive("easyplane.acl-group", networkId, tag);
  }

  private toDto(row: {
    id: string;
    networkId: string;
    version: number;
    document: Record<string, unknown>;
    note: string;
    createdBy: string | null;
    createdAt: Date;
  }): PolicyVersionDto {
    let summary = {
      statements: 0,
      tags: [] as string[],
      groups: [] as string[],
      hosts: [] as string[],
      strictTags: false,
    };
    try {
      summary = describePolicy(row.document as unknown as PolicyDocument);
    } catch {
      // An old/garbled row still lists, just without a summary.
    }
    return {
      id: row.id,
      networkId: row.networkId,
      version: row.version,
      document: row.document,
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      summary,
    };
  }

  async listVersions(networkId: string): Promise<PolicyVersionDto[]> {
    const rows = await listNetworkPolicies(this.db, networkId);
    return rows.map((row) => this.toDto(row));
  }

  async getActive(
    networkId: string,
  ): Promise<{ version: number; policy: PolicyVersionDto | null }> {
    const network = await getNetworkById(this.db, networkId);
    if (!network) notFound("network not found");
    if (network.policyVersion === 0) return { version: 0, policy: null };
    const row = await getNetworkPolicyVersion(this.db, networkId, network.policyVersion);
    return { version: network.policyVersion, policy: row ? this.toDto(row) : null };
  }

  /** Loads everything the compiler needs (no secrets involved). */
  async loadInput(network: Network): Promise<{
    /** Active document, or null when the network has no policy. */
    document: PolicyDocument | null;
    devices: PolicyDevice[];
    users: PolicyUser[];
    knownTags: string[];
    routes: PolicyRouteInput[];
    /** Approved device rows (for revision bookkeeping). */
    deviceRows: Device[];
  }> {
    const [tagRows, tagLinks, userRows, deviceRows, routeRows] = await Promise.all([
      listTags(this.db, network.orgId),
      listDeviceTags(this.db, network.orgId),
      listUsers(this.db, network.orgId),
      listDevicesForReconcile(this.db, network.orgId),
      approvedRoutesForNetwork(this.db, network.id),
    ]);
    const tagsByDevice = new Map<string, string[]>();
    for (const link of tagLinks) {
      const list = tagsByDevice.get(link.deviceId) ?? [];
      list.push(link.tagName);
      tagsByDevice.set(link.deviceId, list);
    }
    const networkDevices = deviceRows.filter(
      (device) => device.networkId === network.id && device.virtualIpv4,
    );
    const routes: PolicyRouteInput[] = routeRows.map((row) => ({
      deviceId: row.deviceId,
      kind: row.kind,
      cidr: row.cidr,
      state: row.state,
    }));
    const users: PolicyUser[] = userRows.map((user) => ({
      id: user.id,
      email: user.email,
      groups: user.groups,
    }));
    const devices: PolicyDevice[] = networkDevices.map((device) => ({
      id: device.id,
      hostname: device.dnsName ?? device.hostname,
      virtualIpv4: device.virtualIpv4 ?? "",
      ownerUserId: device.ownerUserId,
      tags: tagsByDevice.get(device.id) ?? [],
    }));
    const document =
      network.policyVersion > 0
        ? (
            await getNetworkPolicyVersion(
              this.db,
              network.id,
              network.policyVersion,
            )
          )?.document
        : undefined;
    return {
      document: document ? (document as unknown as PolicyDocument) : null,
      devices,
      users,
      knownTags: tagRows.map((tag) => tag.name),
      routes,
      deviceRows: networkDevices,
    };
  }

  /** Compiles the network's active policy for one device. */
  async compileForDevice(network: Network, deviceId: string): Promise<acl.Acl | undefined> {
    const loaded = await this.loadInput(network);
    if (!loaded.document) return undefined;
    return this.compileWith(network, loaded, loaded.document).byDevice.get(deviceId)?.acl;
  }

  private compileWith(
    network: Network,
    loaded: Awaited<ReturnType<PolicyService["loadInput"]>>,
    document: PolicyDocument,
  ): CompileResult {
    return compilePolicy(
      {
        document,
        devices: loaded.devices,
        users: loaded.users,
        knownTags: loaded.knownTags,
        routes: loaded.routes,
      },
      (tag) => this.groupSecret(network.id, tag),
    );
  }

  /**
   * Compiles the network's active policy for revisions that predate policy
   * support. Used by the push path: a revision names the policy version it was
   * created with, so a rollback restores that ACL too.
   */
  async compileForVersion(
    network: Network,
    deviceId: string,
    policyVersion: number,
  ): Promise<acl.Acl | undefined> {
    if (policyVersion === 0) return undefined;
    const row = await getNetworkPolicyVersion(this.db, network.id, policyVersion);
    if (!row) {
      throw new Error(
        `policy version ${policyVersion} of network ${network.id} no longer exists`,
      );
    }
    const loaded = await this.loadInput(network);
    const result = this.compileWith(
      network,
      loaded,
      row.document as unknown as PolicyDocument,
    );
    return result.byDevice.get(deviceId)?.acl;
  }

  private async loadNetwork(actor: RequestActor, networkId: string): Promise<Network> {
    const network = await getNetworkById(this.db, networkId);
    if (!network || network.orgId !== actor.orgId) notFound("network not found");
    return network;
  }

  /**
   * Validates a document against the current network and returns warnings.
   * Strict resolution turns unknown tags/devices into errors, which is what an
   * operator expects right after typing a name.
   */
  async validate(
    actor: RequestActor,
    networkId: string,
    document: PolicyDocument,
  ): Promise<{ warnings: string[]; devices: CompiledAclSummary[]; resolved: CompileResult }> {
    const network = await this.loadNetwork(actor, networkId);
    const loaded = await this.loadInput(network);
    try {
      resolvePolicy(
        {
          document,
          devices: loaded.devices,
          users: loaded.users,
          knownTags: loaded.knownTags,
          routes: loaded.routes,
        },
        { strict: true },
      );
    } catch (error) {
      if (error instanceof SubjectResolutionError) {
        throw new AppError(400, error.issues.join("; "), "policy_invalid_reference");
      }
      throw error;
    }
    const compiled = this.compileWith(network, loaded, document);
    return {
      warnings: compiled.warnings,
      devices: this.summarise(compiled, loaded.devices),
      resolved: compiled,
    };
  }

  private summarise(
    compiled: CompileResult,
    devices: readonly PolicyDevice[],
  ): CompiledAclSummary[] {
    const byId = new Map(devices.map((device) => [device.id, device]));
    return [...compiled.byDevice.values()]
      .map((entry) => {
        const chains = entry.acl.aclV1?.chains ?? [];
        const count = (type: acl.ChainType) =>
          chains.find((chain) => chain.chainType === type)?.rules.length ?? 0;
        return {
          deviceId: entry.deviceId,
          hostname: byId.get(entry.deviceId)?.hostname ?? "",
          inboundRules: count(acl.ChainType.Inbound),
          outboundRules: count(acl.ChainType.Outbound),
          forwardRules: count(acl.ChainType.Forward),
          declaredGroups: [...(entry.acl.aclV1?.group?.declares ?? [])].map(
            (declare) => declare.groupName,
          ),
          hash: shortHash(canonicalAcl(entry.acl)),
        };
      })
      .sort((left, right) => left.hostname.localeCompare(right.hostname));
  }

  async parseAndNormalize(text: string): Promise<PolicyDocument> {
    try {
      return parsePolicyText(text);
    } catch (error) {
      if (error instanceof PolicyValidationError) {
        throw new AppError(
          400,
          [error.message, ...error.issues].join("; "),
          "policy_invalid",
        );
      }
      throw error;
    }
  }

  /**
   * Saves a new policy version and creates a revision per approved device so
   * the compiled ACL is revisioned, audited and rollbackable like any other
   * config change.
   */
  async save(
    actor: RequestActor,
    networkId: string,
    input: { document: unknown; note?: string },
  ): Promise<{ policy: PolicyVersionDto; revisionsCreated: number }> {
    const network = await this.loadNetwork(actor, networkId);
    const document = input.document as PolicyDocument;
    const { warnings } = await this.validate(actor, networkId, document);
    const versions = await listNetworkPolicies(this.db, networkId);
    const version = (versions[0]?.version ?? 0) + 1;
    const row = await insertNetworkPolicy(this.db, {
      orgId: actor.orgId,
      networkId,
      version,
      document: document as unknown as Record<string, unknown>,
      note: input.note ?? "",
      createdBy: actor.userId,
    });
    const updated = await updateNetwork(this.db, networkId, { policyVersion: version });
    if (!updated) throw new AppError(500, "failed to update network policy version");

    const approvedDevices = (await listDevicesForReconcile(this.db, actor.orgId)).filter(
      (device) => device.networkId === networkId,
    );
    let revisionsCreated = 0;
    for (const device of approvedDevices) {
      await this.createPolicyRevision(actor, network, device, version);
      revisionsCreated += 1;
      this.options.push.schedule(device.id, "policy updated");
    }

    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "policy.version_created",
      targetType: "network",
      targetId: networkId,
      metadata: {
        version,
        note: input.note ?? "",
        statements: document.acls.length,
        tags: describePolicy(document).tags,
        warnings: warnings.slice(0, 10),
        revisionsCreated,
      },
    });
    return { policy: this.toDto(row), revisionsCreated };
  }

  private async createPolicyRevision(
    actor: RequestActor,
    network: Network,
    device: Device,
    version: number,
  ): Promise<void> {
    const revisions = await listRevisions(this.db, device.id);
    const latest = revisions[0];
    const config = latest
      ? normalizeDesiredConfig(latest.config, {
          networkLength: cidrPrefix(network.ipv4Cidr),
        })
      : normalizeDesiredConfig(network.defaultConfig, {
          networkLength: cidrPrefix(network.ipv4Cidr),
        });
    const revisionNumber = nextRevisionNumber(
      revisions.map((revision) => ({
        revision: revision.revision,
        config: revision.config,
      })),
    );
    const revision = await insertRevision(this.db, {
      orgId: actor.orgId,
      networkId: network.id,
      deviceId: device.id,
      revision: revisionNumber,
      config,
      note: `policy v${version}`,
      source: "policy",
      policyVersion: version,
      createdBy: actor.userId,
    });
    await updateDevice(this.db, device.id, { desiredRevision: revision.revision });
  }

  /** Removes the network policy: EasyTier's ACL filter is disabled again. */
  async disable(actor: RequestActor, networkId: string): Promise<{ revisionsCreated: number }> {
    const network = await this.loadNetwork(actor, networkId);
    if (network.policyVersion === 0) return { revisionsCreated: 0 };
    const updated = await updateNetwork(this.db, networkId, { policyVersion: 0 });
    if (!updated) throw new AppError(500, "failed to clear the policy");
    const approvedDevices = (await listDevicesForReconcile(this.db, actor.orgId)).filter(
      (device) => device.networkId === networkId,
    );
    for (const device of approvedDevices) {
      await this.createPolicyRevision(actor, network, device, 0);
      this.options.push.schedule(device.id, "policy disabled");
    }
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "policy.disabled",
      targetType: "network",
      targetId: networkId,
      metadata: { previousVersion: network.policyVersion },
    });
    return { revisionsCreated: approvedDevices.length };
  }

  /** Validates an unsaved document and answers "can A reach B on port P?". */
  async preview(
    actor: RequestActor,
    networkId: string,
    input: {
      document: PolicyDocument;
      srcDeviceId: string;
      dstDeviceId?: string;
      dstCidr?: string;
      port?: number;
      protocol: "tcp" | "udp" | "icmp";
    },
  ): Promise<PreviewResult> {
    const network = await this.loadNetwork(actor, networkId);
    const loaded = await this.loadInput(network);
    const devices = loaded.devices;
    const compiled = this.compileWith(network, loaded, input.document);
    const summaries = this.summarise(compiled, devices);
    const src = devices.find((device) => device.id === input.srcDeviceId);
    if (!src) invalid("source device is not approved in this network");
    const srcAcl = compiled.byDevice.get(src.id)?.acl ?? { aclV1: undefined };
    const srcTags = src.tags;

    if (input.dstCidr) {
      const router = devices.find((device) =>
        loaded.routes.some(
          (route) =>
            route.deviceId === device.id &&
            route.kind === "subnet" &&
            route.state === "approved" &&
            route.cidr === input.dstCidr,
        ),
      );
      if (!router) {
        throw new AppError(
          400,
          `no approved subnet route serves ${input.dstCidr}`,
          "no_route",
        );
      }
      const routerAcl = compiled.byDevice.get(router.id)?.acl ?? { aclV1: undefined };
      const result = evaluateCidrReachability({
        srcAcl,
        routerAcl,
        srcIp: src.virtualIpv4,
        cidr: input.dstCidr,
        protocol: input.protocol,
        ...(input.port !== undefined ? { port: input.port } : {}),
        srcTags,
      });
      return {
        warnings: compiled.warnings,
        devices: summaries,
        reachability: this.toReachability(result),
      };
    }

    const dst = devices.find((device) => device.id === input.dstDeviceId);
    if (!dst) invalid("destination device is not approved in this network");
    const dstAcl = compiled.byDevice.get(dst.id)?.acl ?? { aclV1: undefined };
    const result: ReachabilityResult = evaluateReachability({
      srcAcl,
      dstAcl,
      srcIp: src.virtualIpv4,
      dstIp: dst.virtualIpv4,
      protocol: input.protocol,
      ...(input.port !== undefined ? { port: input.port } : {}),
      srcTags,
      dstTags: dst.tags,
    });
    return {
      warnings: compiled.warnings,
      devices: summaries,
      reachability: this.toReachability(result),
    };
  }

  private toReachability(result: ReachabilityResult): PreviewResult["reachability"] {
    return {
      allowed: result.allowed,
      egress: {
        action: result.egress.action,
        matchedRule: result.egress.matchedRule,
      },
      ingress: {
        action: result.ingress.action,
        matchedRule: result.ingress.matchedRule,
      },
      explanation: result.explanation,
    };
  }

  /** "Can A reach B on port P" against the saved policy. */
  async testReachability(
    actor: RequestActor,
    networkId: string,
    input: {
      srcDeviceId: string;
      dstDeviceId?: string;
      dstCidr?: string;
      port?: number;
      protocol: "tcp" | "udp" | "icmp";
    },
  ): Promise<PreviewResult & { policyVersion: number }> {
    const network = await this.loadNetwork(actor, networkId);
    const active = await this.getActive(networkId);
    if (!active.policy) {
      throw new AppError(
        409,
        "this network has no policy; traffic is unrestricted",
        "no_policy",
      );
    }
    const result = await this.preview(actor, networkId, {
      document: active.policy.document as unknown as PolicyDocument,
      ...input,
    });
    return { ...result, policyVersion: active.version };
  }

  /** Convenience used by the network detail page. */
  async status(networkId: string): Promise<{
    version: number;
    statements: number;
    tags: string[];
    groups: string[];
  }> {
    const active = await this.getActive(networkId);
    if (!active.policy) return { version: 0, statements: 0, tags: [], groups: [] };
    return {
      version: active.version,
      ...describePolicy(active.policy.document as unknown as PolicyDocument),
    };
  }

  /** Creates (or updates) a tag and audits it, so policy subjects are traceable. */
  async createTag(
    actor: RequestActor,
    input: { name: string; color?: string },
  ): Promise<{ id: string; name: string; color: string }> {
    const tag = await upsertTag(this.db, {
      orgId: actor.orgId,
      name: input.name,
      color: input.color,
    });
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "tag.created",
      targetType: "tag",
      targetId: tag.id,
      metadata: { name: tag.name },
    });
    return { id: tag.id, name: tag.name, color: tag.color };
  }

}
