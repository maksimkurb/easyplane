import { acl } from "@easyplane/proto";

import type { DbExecutor } from "../db/repositories.js";
import {
  addUserGroupMember,
  approvedRoutesForNetwork,
  deleteTag,
  deleteUserGroup,
  getDeviceById,
  getNetworkById,
  getNetworkPolicyVersion,
  getUserGroup,
  insertNetworkPolicy,
  insertRevision,
  listDeviceTags,
  listDevicesForReconcile,
  listNetworkPolicies,
  listRevisions,
  listTags,
  listUserGroupMembers,
  listUserGroups,
  listUsers,
  listOrgWireguardClients,
  listWireguardClients,
  removeUserGroupMember,
  replaceUserGroupMembers,
  setTagDevices,
  updateWireguardClient,
  upsertTag,
  upsertUserGroup,
  updateDevice,
  updateNetwork,
} from "../db/repositories.js";
import type { Network, User, WireguardClient } from "../db/schema.js";
import { normalizeDesiredConfig } from "../domain/desired-config.js";
import {
  PolicyValidationError,
  compilePolicy,
  describePolicy,
  evaluateChain,
  evaluateReachability,
  normalizePolicyDocument,
  normalizePolicyDocumentWithMeta,
  parsePolicyText,
  resolvePolicy,
  SubjectResolutionError,
  tagGroupName,
  userGroupName,
  type CompileResult,
  type PolicyChainName,
  type PolicyDevice,
  type PolicyDocument,
  type PolicyMode,
  type PolicyRouteInput,
  type PolicySubnetInput,
  type PolicyUser,
  type PolicyUserGroupInput,
  type ReachabilityResult,
  type ResolvedStatement,
} from "../domain/policy/index.js";
import { canonicalAcl } from "../domain/policy/canonical.js";
import { cidrPrefix } from "../domain/ip.js";
import { normalizeCidr } from "../domain/routes.js";
import { nextRevisionNumber } from "../domain/revisions.js";
import type { SecretBox } from "../security/crypto.js";
import { AppError, invalid, notFound } from "./errors.js";
import type { RealtimeHub } from "../realtime/hub.js";
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
  summary: PolicySummary;
}

export interface PolicySummary {
  statements: number;
  tags: string[];
  groups: string[];
  hosts: string[];
  subnets: string[];
  strictTags: boolean;
  strictGroups: boolean;
  mode: PolicyMode;
  chains: Record<PolicyChainName, { default: "allow" | "block"; enabled: boolean; name?: string }>;
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

export type SubjectViewKind =
  | "any"
  | "device"
  | "tag"
  | "group"
  | "subnet"
  | "host"
  | "cidr";

/** A rule subject as the API/UI needs it: structured, with display fields. */
export interface SubjectView {
  subject: string;
  kind: SubjectViewKind;
  id: string;
  name: string;
  display: string;
  /** Short detail line (IP, CIDR, router, source). */
  detail?: string;
  /** Devices this subject resolves to, when that is meaningful. */
  deviceCount: number;
  /** People in a user group. */
  peopleCount?: number;
  /** Synced groups cannot be edited. */
  readOnly?: boolean;
  source?: "manual" | "oidc";
}

export interface PolicyRuleView {
  index: number;
  name: string | null;
  enabled: boolean;
  action: "allow" | "deny";
  protocol: string;
  ports: string[];
  sourcePorts: string[];
  stateful: boolean;
  rateLimit: number | null;
  burst: number | null;
  from: SubjectView[];
  to: SubjectView[];
  /** Devices whose compiled ACL carries a rule for this statement. */
  affectedDeviceCount: number;
}

export interface PolicyTagDto {
  id: string;
  /** Bare name (`us`). */
  name: string;
  /** Policy subject (`tag:us`). */
  subject: string;
  color: string;
  deviceCount: number;
  devices: Array<{
    id: string;
    name: string;
    hostname: string;
    kind?: "device" | "wireguard";
  }>;
}

export interface PolicyUserGroupDto {
  id: string;
  name: string;
  subject: string;
  source: "manual" | "oidc";
  readOnly: boolean;
  color: string;
  members: Array<{ email: string; displayName: string | null; inOrganisation: boolean }>;
  peopleCount: number;
  deviceCount: number;
  devices: Array<{ id: string; name: string }>;
}

export interface PolicySubnetDto {
  /** Alias used in `subnet:<alias>`. */
  id: string;
  name: string;
  display: string;
  cidr: string;
  viaDeviceId: string | null;
  viaHostname: string;
  routeId: string | null;
  approved: boolean;
}

export interface PolicyHostDto {
  alias: string;
  subject: string;
  value: string;
}

export interface PolicyCatalog {
  devices: Array<{
    id: string;
    name: string;
    hostname: string;
    virtualIpv4: string | null;
    state: string;
    tags: string[];
    /** `wireguard` clients are policy subjects served by a hub portal. */
    kind?: "device" | "wireguard";
  }>;
  tags: PolicyTagDto[];
  userGroups: PolicyUserGroupDto[];
  subnets: PolicySubnetDto[];
  hosts: PolicyHostDto[];
}

export interface PolicyStateDto {
  version: number;
  mode: PolicyMode;
  policy: PolicyVersionDto | null;
  /** The active document with everything resolved for the editor. */
  document: Record<string, unknown> | null;
  rules: PolicyRuleView[];
  summary: PolicySummary | null;
  /** Approved devices that would receive this document. */
  deviceCount: number;
}

export interface CompiledAclDto {
  deviceId: string;
  hostname: string;
  virtualIpv4: string | null;
  /** No ACL means EasyTier's filter is off (open mode / policy disabled). */
  enabled: boolean;
  policyVersion: number;
  mode: PolicyMode;
  chains: Array<{
    name: string;
    chainType: "Inbound" | "Outbound" | "Forward";
    enabled: boolean;
    defaultAction: "Allow" | "Drop";
    rules: Array<{
      name: string;
      description: string;
      priority: number;
      enabled: boolean;
      protocol: string;
      ports: string[];
      sourceIps: string[];
      destinationIps: string[];
      sourcePorts: string[];
      action: "Allow" | "Drop";
      rateLimit: number;
      burstLimit: number;
      stateful: boolean;
      sourceGroups: string[];
      destinationGroups: string[];
    }>;
  }>;
  group: {
    declares: Array<{ groupName: string }>;
    members: string[];
  };
  hash: string;
}

export interface ReachabilityDto {
  allowed: boolean;
  egress: { action: string; matchedRule: string | null };
  ingress: { action: string; matchedRule: string | null };
  explanation: string[];
  /** Best-effort chain-by-chain trace, including the subnet hop. */
  trace: Array<{
    deviceId: string;
    hostname: string;
    chain: "Inbound" | "Outbound" | "Forward";
    action: string;
    matchedRule: string | null;
    byDefault: boolean;
  }>;
  /** Which hop decides the result. */
  decidedBy: { deviceId: string; hostname: string; chain: string } | null;
  srcIp: string;
  dstIp: string;
}

export interface PreviewResult {
  warnings: string[];
  devices: CompiledAclSummary[];
  reachability: ReachabilityDto;
}

export interface PolicyServiceOptions {
  db: DbExecutor;
  secretBox: SecretBox;
  audit: AuditService;
  push: PushService;
  /** Live browser fan-out; optional so unit tests can omit it. */
  realtime?: RealtimeHub;
}

interface LoadedInput {
  /** Active document, or null when the network has no policy. */
  document: PolicyDocument | null;
  devices: PolicyDevice[];
  users: PolicyUser[];
  knownTags: string[];
  routes: PolicyRouteInput[];
  subnets: PolicySubnetInput[];
  userGroups: PolicyUserGroupInput[];
  /** Approved device rows (for revision bookkeeping). */
  deviceRows: Awaited<ReturnType<typeof listDevicesForReconcile>>;
  /** WireGuard portal clients of this network (policy subjects, not devices). */
  wireguardRows: WireguardClient[];
  /** Groups a device must declare for its portal clients (`tag:...`). */
  extraDeclaredGroups: Map<string, string[]>;
  /** Tag rows with device links, for the catalog/view. */
  tagRows: Array<{ id: string; name: string; color: string }>;
  tagLinks: Array<{ deviceId: string; tagName: string }>;
  /** User-group rows (manual) and their members. */
  groupRows: Array<{
    id: string;
    name: string;
    source: "manual" | "oidc";
    oidcValue: string;
    color: string;
  }>;
  groupMembers: Array<{ groupId: string; email: string }>;
  routeRows: Awaited<ReturnType<typeof approvedRoutesForNetwork>>;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "subnet"
  );
}

function subnetAliasFor(device: string, cidr: string): string {
  return slug(`${device}-${cidr}`);
}

/** One distinct IdP group value becomes a read-only synced user group. */
function syncedGroups(users: readonly User[]): PolicyUserGroupInput[] {
  const byValue = new Map<string, string[]>();
  for (const user of users) {
    for (const value of user.groups) {
      const name = value.trim();
      if (!name) continue;
      const members = byValue.get(name) ?? [];
      if (!members.includes(user.email.toLowerCase())) {
        members.push(user.email.toLowerCase());
      }
      byValue.set(name, members);
    }
  }
  return [...byValue.entries()]
    .map(([name, members]) => ({ name, source: "oidc" as const, members }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Policy source of truth: versioned documents, the compiled per-device ACL,
 * the subject catalog and the reachability preview. Secrets never enter the
 * database: EasyTier group secrets are derived from `EASYPLANE_ENCRYPTION_KEY`
 * and the network id.
 */
export class PolicyService {
  constructor(private readonly options: PolicyServiceOptions) {}

  private get db(): DbExecutor {
    return this.options.db;
  }

  /** EasyTier group secret for a group name (`tag:x` / `group:y`). */
  groupSecret(networkId: string, group: string): string {
    return this.options.secretBox.derive("easyplane.acl-group", networkId, group);
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
    let summary: PolicySummary = {
      statements: 0,
      tags: [],
      groups: [],
      hosts: [],
      subnets: [],
      strictTags: false,
      strictGroups: false,
      mode: "rules",
      chains: {
        inbound: { default: "block", enabled: true },
        outbound: { default: "allow", enabled: true },
        forward: { default: "block", enabled: true },
      },
    };
    try {
      const document = normalizePolicyDocument(row.document);
      summary = describePolicy(document);
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

  /** Effective policy state: open mode reports version 0 and no document. */
  async getActive(
    networkId: string,
  ): Promise<{ version: number; mode: PolicyMode; policy: PolicyVersionDto | null }> {
    const network = await getNetworkById(this.db, networkId);
    if (!network) notFound("network not found");
    if (network.policyVersion === 0) {
      return { version: 0, mode: network.policyMode, policy: null };
    }
    const row = await getNetworkPolicyVersion(
      this.db,
      networkId,
      network.policyVersion,
    );
    return {
      version: network.policyVersion,
      mode: network.policyMode,
      policy: row ? this.toDto(row) : null,
    };
  }

  /** The editor's full state: document, structured rules and summary. */
  async getState(networkId: string): Promise<PolicyStateDto> {
    const network = await getNetworkById(this.db, networkId);
    if (!network) notFound("network not found");
    const active = await this.getActive(networkId);
    if (!active.policy) {
      return {
        version: 0,
        mode: network.policyMode,
        policy: null,
        document: null,
        rules: [],
        summary: null,
        deviceCount: await this.approvedDeviceCount(network.id),
      };
    }
    const loaded = await this.loadInput(network);
    const document = this.enrichDocument(network, active.policy.document, loaded);
    const resolved = resolvePolicy(this.resolveInput(loaded, document), {
      strict: false,
    });
    return {
      version: active.version,
      mode: network.policyMode,
      policy: { ...active.policy, document: document as unknown as Record<string, unknown> },
      document: document as unknown as Record<string, unknown>,
      rules: this.ruleViews(document, resolved.statements, loaded, network),
      summary: describePolicy(document),
      deviceCount: loaded.deviceRows.length,
    };
  }

  private async approvedDeviceCount(networkId: string): Promise<number> {
    const network = await getNetworkById(this.db, networkId);
    if (!network) return 0;
    const rows = await listDevicesForReconcile(this.db, network.orgId);
    return rows.filter(
      (device) => device.networkId === networkId && device.virtualIpv4,
    ).length;
  }

  /** Loads everything the compiler needs (no secrets involved). */
  async loadInput(network: Network): Promise<LoadedInput> {
    const [
      tagRows,
      tagLinks,
      userRows,
      deviceRows,
      routeRows,
      groupRows,
      groupMembers,
      wireguardRows,
    ] = await Promise.all([
      listTags(this.db, network.orgId),
      listDeviceTags(this.db, network.orgId),
      listUsers(this.db, network.orgId),
      listDevicesForReconcile(this.db, network.orgId),
      approvedRoutesForNetwork(this.db, network.id),
      listUserGroups(this.db, network.orgId),
      listUserGroupMembers(this.db, network.orgId),
      listWireguardClients(this.db, network.id),
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
      kind: "device",
    }));
    // WireGuard portal clients are first-class policy subjects: they own an
    // address from the same pool and carry tags, but they are not EasyTier
    // instances. A hub's compiled ACL declares the groups its portal clients
    // use, because upstream rejects a client whose groups are not declared.
    for (const client of wireguardRows) {
      devices.push({
        id: client.id,
        hostname: client.name,
        virtualIpv4: client.virtualIpv4,
        ownerUserId: client.ownerUserId,
        tags: client.tags,
        kind: "wireguard",
      });
    }
    const extraDeclaredGroups = new Map<string, string[]>();
    for (const client of wireguardRows) {
      const groups = client.tags
        .map(tagGroupName)
        .filter((group) => group.startsWith("tag:"));
      if (groups.length === 0) continue;
      const current = extraDeclaredGroups.get(client.hubDeviceId) ?? [];
      extraDeclaredGroups.set(client.hubDeviceId, [...new Set([...current, ...groups])]);
    }

    let document: PolicyDocument | null = null;
    if (network.policyVersion > 0) {
      const row = await getNetworkPolicyVersion(
        this.db,
        network.id,
        network.policyVersion,
      );
      if (row) {
        try {
          document = normalizePolicyDocument(row.document);
        } catch {
          document = null;
        }
      }
    }
    const { subnets, userGroups } = this.collectionsFor(
      network,
      document,
      routeRows,
      groupRows,
      groupMembers,
      userRows,
      networkDevices,
    );
    return {
      document,
      devices,
      users,
      knownTags: tagRows.map((tag) => tag.name),
      routes,
      subnets,
      userGroups,
      deviceRows: networkDevices,
      wireguardRows,
      extraDeclaredGroups,
      tagRows: tagRows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
      })),
      tagLinks,
      groupRows: groupRows.map((row) => ({
        id: row.id,
        name: row.name,
        source: row.source,
        oidcValue: row.oidcValue,
        color: row.color,
      })),
      groupMembers,
      routeRows,
    };
  }

  /** Manual DB groups + synced IdP groups + groups embedded in old documents. */
  private collectionsFor(
    network: Network,
    document: PolicyDocument | null,
    routeRows: LoadedInput["routeRows"],
    groupRows: LoadedInput["groupRows"],
    groupMembers: LoadedInput["groupMembers"],
    userRows: User[],
    deviceRows: LoadedInput["deviceRows"],
  ): { subnets: PolicySubnetInput[]; userGroups: PolicyUserGroupInput[] } {
    const deviceNameById = new Map<string, string>(
      deviceRows.map((device) => [
        device.id,
        device.dnsName ?? device.hostname ?? "router",
      ]),
    );
    const membersByGroup = new Map<string, string[]>();
    for (const member of groupMembers) {
      const list = membersByGroup.get(member.groupId) ?? [];
      list.push(member.email);
      membersByGroup.set(member.groupId, list);
    }
    const manual: PolicyUserGroupInput[] = groupRows.map((row) => ({
      name: row.name,
      source: row.source,
      members:
        row.source === "manual"
          ? (membersByGroup.get(row.id) ?? [])
          : (syncedGroups(userRows).find((group) => group.name === row.name)?.members ?? []),
    }));
    const manualNames = new Set(manual.map((group) => group.name));
    const synced = syncedGroups(userRows).filter(
      (group) => !manualNames.has(group.name),
    );
    const embedded: PolicyUserGroupInput[] = Object.entries(
      document?.userGroups ?? {},
    )
      .filter(([name]) => {
        const bare = name.startsWith("group:") ? name.slice("group:".length) : name;
        return !manualNames.has(bare) && !synced.some((group) => group.name === bare);
      })
      .map(([name, group]) => ({
        name: name.startsWith("group:") ? name.slice("group:".length) : name,
        source: group.source,
        members: group.members,
      }));

    const subnets: PolicySubnetInput[] = [];
    const docSubnets = Object.entries(document?.subnets ?? {});
    const usedAliases = new Set<string>();
    for (const route of routeRows) {
      if (route.kind !== "subnet" || route.state !== "approved") continue;
      const cidr = route.cidr;
      const existing = docSubnets.find(([, subnet]) => subnet.cidr === cidr);
      const alias = existing
        ? existing[0]
        : (() => {
            const device = deviceNameById.get(route.deviceId) ?? "router";
            const base = subnetAliasFor(device, cidr);
            let candidate = base;
            let suffix = 2;
            while (docSubnets.some(([name]) => name === candidate)) {
              candidate = `${base}-${suffix++}`;
            }
            return candidate;
          })();
      usedAliases.add(alias);
      subnets.push({ name: alias, cidr, viaDeviceId: route.deviceId, approved: true });
    }
    for (const [alias, subnet] of docSubnets) {
      if (usedAliases.has(alias)) continue;
      subnets.push({
        name: alias,
        cidr: subnet.cidr,
        viaDeviceId: null,
        approved: false,
        ...(subnet.via ? { via: subnet.via } : {}),
      });
    }
    return { subnets, userGroups: [...manual, ...synced, ...embedded] };
  }

  private resolveInput(loaded: LoadedInput, document: PolicyDocument) {
    return {
      document,
      devices: loaded.devices,
      users: loaded.users,
      knownTags: loaded.knownTags,
      routes: loaded.routes,
      subnets: loaded.subnets,
      userGroups: loaded.userGroups,
      extraDeclaredGroups: loaded.extraDeclaredGroups,
    };
  }

  /**
   * Adds the server-derived sections to a stored/returned document: named
   * subnets for approved routes, tag assignments and user groups. Stored
   * documents are already enriched on save; old v1 rows get the same treatment
   * on read so JSON mode shows the real state instead of an empty section.
   */
  private enrichDocument(
    network: Network,
    raw: Record<string, unknown>,
    loaded: LoadedInput,
  ): PolicyDocument {
    const document = normalizePolicyDocument(raw);
    const subnets: Record<string, { cidr: string; via?: string }> = {
      ...document.subnets,
    };
    const devicesById = new Map(loaded.deviceRows.map((row) => [row.id, row]));
    for (const [alias, subnet] of Object.entries(subnets)) {
      if (subnet.via) continue;
      const route = loaded.routeRows.find(
        (row) =>
          row.kind === "subnet" &&
          row.state === "approved" &&
          row.cidr === subnet.cidr,
      );
      const device = route ? devicesById.get(route.deviceId) : undefined;
      if (device) {
        const name = device.dnsName ?? device.hostname;
        if (name) subnets[alias] = { ...subnet, via: name };
      }
    }
    // Named routes without an alias: create one so the picker and JSON view
    // have a stable subject for every approved subnet.
    for (const row of loaded.routeRows) {
      if (row.kind !== "subnet" || row.state !== "approved") continue;
      if (Object.values(subnets).some((subnet) => subnet.cidr === row.cidr)) continue;
      const device = devicesById.get(row.deviceId);
      const name = device ? (device.dnsName ?? device.hostname) : "router";
      const base = subnetAliasFor(name, row.cidr);
      let alias = base;
      let suffix = 2;
      while (subnets[alias]) alias = `${base}-${suffix++}`;
      subnets[alias] = { cidr: row.cidr, via: name };
    }

    const tags: Record<string, string[]> = {};
    for (const tag of loaded.tagRows) {
      tags[tag.name.replace(/^tag:/, "")] = [];
    }
    const deviceById = new Map(loaded.deviceRows.map((row) => [row.id, row]));
    for (const link of loaded.tagLinks) {
      const device = deviceById.get(link.deviceId);
      if (!device || device.networkId !== network.id) continue;
      const name = device.dnsName ?? device.hostname;
      if (!name) continue;
      const key = link.tagName.replace(/^tag:/, "");
      tags[key] = [...new Set([...(tags[key] ?? []), name])].sort();
    }
    // WireGuard portal clients carry their own tags and appear in the same
    // tag membership, so the document round-trips them instead of dropping
    // them on the next save.
    for (const client of loaded.wireguardRows) {
      for (const raw of client.tags) {
        const key = raw.replace(/^tag:/, "");
        tags[key] = [...new Set([...(tags[key] ?? []), client.name])].sort();
      }
    }
    const userGroups: Record<string, { source: "manual" | "oidc"; members: string[] }> = {};
    for (const group of loaded.userGroups) {
      userGroups[group.name] = { source: group.source, members: group.members };
    }
    for (const [name, group] of Object.entries(document.userGroups ?? {})) {
      if (!userGroups[name]) userGroups[name] = group;
    }

    return {
      ...document,
      subnets,
      tags,
      userGroups,
    };
  }

  private async enrichStoredDocument(
    network: Network,
    document: PolicyDocument,
    loaded: LoadedInput,
  ): Promise<PolicyDocument> {
    return this.enrichDocument(network, document as unknown as Record<string, unknown>, loaded);
  }

  /** Compiles the network's active policy for one device. */
  async compileForDevice(
    network: Network,
    deviceId: string,
  ): Promise<acl.Acl | undefined> {
    if (network.policyMode === "open") return undefined;
    const loaded = await this.loadInput(network);
    if (!loaded.document) return undefined;
    return this.compileWith(network, loaded, loaded.document).byDevice.get(deviceId)
      ?.acl;
  }

  private compileWith(
    network: Network,
    loaded: LoadedInput,
    document: PolicyDocument,
  ): CompileResult {
    return compilePolicy(this.resolveInput(loaded, document), (group) =>
      this.groupSecret(network.id, group),
    );
  }

  /**
   * Compiles a policy version for revisions that pin one. A rolled-back
   * revision must restore the ACL it was created with, including a version
   * that was saved while the network was in `rules` mode.
   */
  async compileForVersion(
    network: Network,
    deviceId: string,
    policyVersion: number,
  ): Promise<acl.Acl | undefined> {
    if (policyVersion === 0) return undefined;
    // Open mode is an explicit "no ACL" state; a pinned revision must not
    // resurrect an ACL behind the operator's back.
    if (network.policyMode === "open") return undefined;
    const row = await getNetworkPolicyVersion(this.db, network.id, policyVersion);
    if (!row) {
      throw new Error(
        `policy version ${policyVersion} of network ${network.id} no longer exists`,
      );
    }
    const loaded = await this.loadInput(network);
    const document = normalizePolicyDocument(row.document);
    return this.compileWith(network, loaded, document).byDevice.get(deviceId)?.acl;
  }

  private async loadNetwork(actor: RequestActor, networkId: string): Promise<Network> {
    const network = await getNetworkById(this.db, networkId);
    if (!network || network.orgId !== actor.orgId) notFound("network not found");
    return network;
  }

  /**
   * Validates a document against the current network and returns warnings.
   * Strict resolution turns unknown tags/groups/devices/subnets into errors.
   */
  async validate(
    actor: RequestActor,
    networkId: string,
    document: PolicyDocument,
  ): Promise<{ warnings: string[]; devices: CompiledAclSummary[]; resolved: CompileResult }> {
    const network = await this.loadNetwork(actor, networkId);
    const loaded = await this.loadInput(network);
    // A document may define groups/tags/subnets that do not exist in the DB
    // yet; resolve against the union so validation of an unsaved edit is
    // useful (the save path creates them).
    const merged = this.mergeDocumentCollections(loaded, document);
    try {
      resolvePolicy(this.resolveInput(merged, document), { strict: true });
    } catch (error) {
      if (error instanceof SubjectResolutionError) {
        throw new AppError(400, error.issues.join("; "), "policy_invalid_reference");
      }
      throw error;
    }
    const compiled = this.compileWith(network, merged, document);
    return {
      warnings: compiled.warnings,
      devices: this.summarise(compiled, merged.devices),
      resolved: compiled,
    };
  }

  /** Adds the document's own tags/groups/subnets to a loaded input for validation. */
  private mergeDocumentCollections(
    loaded: LoadedInput,
    document: PolicyDocument,
  ): LoadedInput {
    const knownTags = new Set(loaded.knownTags.map(tagGroupName));
    for (const name of Object.keys(document.tags ?? {})) {
      knownTags.add(tagGroupName(name));
    }
    const groups = new Map(loaded.userGroups.map((group) => [group.name, group]));
    for (const [name, group] of Object.entries(document.userGroups ?? {})) {
      const bare = name.startsWith("group:") ? name.slice("group:".length) : name;
      if (!groups.has(bare)) {
        groups.set(bare, { name: bare, source: group.source, members: group.members });
      }
    }
    const subnets = new Map(loaded.subnets.map((subnet) => [subnet.name, subnet]));
    for (const [alias, subnet] of Object.entries(document.subnets)) {
      if (subnets.has(alias)) continue;
      // A document alias for a CIDR that an approved route serves inherits
      // that route: `subnet:home-lan` is usable before the first save.
      const route = [...subnets.values()].find(
        (entry) => entry.approved !== false && entry.cidr === subnet.cidr,
      );
      const viaDevice = subnet.via
        ? loaded.devices.find(
            (device) => device.hostname.toLowerCase() === subnet.via!.toLowerCase(),
          )
        : undefined;
      subnets.set(alias, {
        name: alias,
        cidr: subnet.cidr,
        viaDeviceId: route?.viaDeviceId ?? viaDevice?.id ?? null,
        approved: Boolean(route),
        ...(subnet.via ? { via: subnet.via } : {}),
      });
    }
    return {
      ...loaded,
      knownTags: [...knownTags],
      userGroups: [...groups.values()],
      subnets: [...subnets.values()],
    };
  }

  private summarise(
    compiled: CompileResult,
    devices: readonly PolicyDevice[],
  ): CompiledAclSummary[] {
    const byId = new Map(devices.map((device) => [device.id, device]));
    return [...compiled.byDevice.values()]
      .filter((entry) => byId.get(entry.deviceId)?.kind !== "wireguard")
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
   * Normalizes a document for the API. v1 documents are upgraded and the
   * result is reported so the caller can note the migration in the audit log.
   */
  normalize(input: unknown): { document: PolicyDocument; upgradedFromV1: boolean } {
    try {
      return normalizePolicyDocumentWithMeta(input);
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
   * Applies the document's `tags` and `userGroups` sections to the database.
   * Absent sections mean "leave the collections alone"; the stored document is
   * always enriched afterwards, so a plain round-trip is idempotent.
   */
  async synchronizeCollections(
    actor: RequestActor,
    network: Network,
    document: PolicyDocument,
  ): Promise<void> {
    const networkDevices = (await listDevicesForReconcile(this.db, network.orgId)).filter(
      (device) => device.networkId === network.id,
    );
    const byName = new Map(
      networkDevices.map((device) => [
        (device.dnsName ?? device.hostname).toLowerCase(),
        device,
      ]),
    );
    const wireguardRows = await listWireguardClients(this.db, network.id);
    const wireguardByName = new Map(
      wireguardRows.map((client) => [client.name.toLowerCase(), client]),
    );
    if (document.userGroups) {
      for (const [name, group] of Object.entries(document.userGroups)) {
        const bare = name.startsWith("group:") ? name.slice("group:".length) : name;
        const row = await upsertUserGroup(this.db, {
          orgId: actor.orgId,
          name: bare,
          source: group.source,
          oidcValue: group.source === "oidc" ? bare : "",
          createdBy: actor.userId,
        });
        if (group.source === "manual") {
          await replaceUserGroupMembers(this.db, row.id, group.members);
        }
      }
    }
    if (document.tags) {
      for (const [name, deviceNames] of Object.entries(document.tags)) {
        const tagName = tagGroupName(name);
        const tag = await upsertTag(this.db, {
          orgId: actor.orgId,
          name: tagName,
        });
        const deviceIds: string[] = [];
        const wireguardIds = new Set<string>();
        for (const deviceName of deviceNames) {
          const device = byName.get(deviceName.toLowerCase());
          if (device) {
            deviceIds.push(device.id);
            continue;
          }
          const client = wireguardByName.get(deviceName.toLowerCase());
          if (client) {
            wireguardIds.add(client.id);
            continue;
          }
          throw invalid(`tag "${name}": device "${deviceName}" is not in this network`);
        }
        await setTagDevices(this.db, tag.id, deviceIds);
        // WireGuard clients are not devices; their tags live on their own row.
        for (const client of wireguardRows) {
          const next = new Set(
            client.tags.map((entry) => entry.toLowerCase()),
          );
          if (wireguardIds.has(client.id)) next.add(tagName);
          else next.delete(tagName);
          const tags = [...next].sort();
          const same =
            tags.length === client.tags.length &&
            tags.every((entry, index) => entry === client.tags[index]?.toLowerCase());
          if (same) continue;
          const updated = await updateWireguardClient(this.db, client.id, { tags });
          if (updated) client.tags = updated.tags;
        }
      }
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
    input: {
      document: PolicyDocument;
      note?: string;
      mode?: PolicyMode;
      upgradedFromV1?: boolean;
    },
  ): Promise<{
    policy: PolicyVersionDto;
    revisionsCreated: number;
    upgradedFromV1: boolean;
  }> {
    const network = await this.loadNetwork(actor, networkId);
    const mode = input.mode ?? input.document.mode ?? "rules";
    const document: PolicyDocument = { ...input.document, mode };
    await this.synchronizeCollections(actor, network, document);
    let loaded = await this.loadInput(network);
    const prepared = await this.enrichStoredDocument(network, document, loaded);
    // The collections may have changed; reload before compiling.
    loaded = await this.loadInput(network);
    const finalDocument = await this.enrichStoredDocument(network, prepared, loaded);
    const { warnings } = await this.validate(actor, networkId, finalDocument);
    const versions = await listNetworkPolicies(this.db, networkId);
    const version = (versions[0]?.version ?? 0) + 1;
    const row = await insertNetworkPolicy(this.db, {
      orgId: actor.orgId,
      networkId,
      version,
      document: finalDocument as unknown as Record<string, unknown>,
      note: input.note ?? "",
      createdBy: actor.userId,
    });
    const updated = await updateNetwork(this.db, networkId, {
      policyVersion: version,
      policyMode: mode,
    });
    if (!updated) throw new AppError(500, "failed to update network policy version");

    const approvedDevices = (await listDevicesForReconcile(this.db, actor.orgId)).filter(
      (device) => device.networkId === networkId,
    );
    let revisionsCreated = 0;
    const revisionVersion = mode === "open" ? 0 : version;
    for (const device of approvedDevices) {
      await this.createPolicyRevision(actor, network, device, revisionVersion);
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
        mode,
        note: input.note ?? "",
        statements: finalDocument.rules.length,
        tags: describePolicy(finalDocument).tags,
        warnings: warnings.slice(0, 10),
        revisionsCreated,
      },
    });
    this.options.realtime?.publish({
      type: "policy.updated",
      orgId: actor.orgId,
      networkId,
      data: { networkId, version, revisionsCreated, mode },
    });
    return {
      policy: this.toDto(row),
      revisionsCreated,
      upgradedFromV1: input.upgradedFromV1 ?? false,
    };
  }

  private async createPolicyRevision(
    actor: RequestActor,
    network: Network,
    device: { id: string },
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

  /** Switches the access mode without touching the stored document. */
  async setMode(
    actor: RequestActor,
    networkId: string,
    mode: PolicyMode,
  ): Promise<{ version: number; mode: PolicyMode; revisionsCreated: number }> {
    const network = await this.loadNetwork(actor, networkId);
    if ((mode === "rules" || mode === "json") && network.policyVersion === 0) {
      throw new AppError(409, "save a policy before enabling it", "no_policy");
    }
    const updated = await updateNetwork(this.db, networkId, { policyMode: mode });
    if (!updated) throw new AppError(500, "failed to update the policy mode");
    const approvedDevices = (await listDevicesForReconcile(this.db, actor.orgId)).filter(
      (device) => device.networkId === networkId,
    );
    const revisionVersion = mode === "open" ? 0 : network.policyVersion;
    for (const device of approvedDevices) {
      await this.createPolicyRevision(actor, network, device, revisionVersion);
      this.options.push.schedule(device.id, `policy mode ${mode}`);
    }
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "policy.mode_changed",
      targetType: "network",
      targetId: networkId,
      metadata: { mode, previousMode: network.policyMode, version: revisionVersion },
    });
    this.options.realtime?.publish({
      type: "policy.updated",
      orgId: actor.orgId,
      networkId,
      data: { networkId, version: revisionVersion, revisionsCreated: approvedDevices.length, mode },
    });
    return { version: revisionVersion, mode, revisionsCreated: approvedDevices.length };
  }

  /** Removes the network policy: EasyTier's ACL filter is disabled again. */
  async disable(actor: RequestActor, networkId: string): Promise<{ revisionsCreated: number }> {
    const network = await this.loadNetwork(actor, networkId);
    if (network.policyVersion === 0 && network.policyMode === "open") {
      return { revisionsCreated: 0 };
    }
    const updated = await updateNetwork(this.db, networkId, {
      policyVersion: 0,
      policyMode: "open",
    });
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
    this.options.realtime?.publish({
      type: "policy.updated",
      orgId: actor.orgId,
      networkId,
      data: { networkId, version: 0, revisionsCreated: approvedDevices.length, mode: "open" },
    });
    return { revisionsCreated: approvedDevices.length };
  }

  /** Validates an unsaved document and answers "can A reach B on port P?". */
  async preview(
    actor: RequestActor,
    networkId: string,
    input: {
      document: PolicyDocument;
      srcDeviceId?: string;
      srcIp?: string;
      dstDeviceId?: string;
      dstCidr?: string;
      port?: number;
      protocol: "tcp" | "udp" | "icmp" | "icmpv6";
    },
  ): Promise<PreviewResult> {
    const network = await this.loadNetwork(actor, networkId);
    const loaded = await this.loadInput(network);
    const merged = this.mergeDocumentCollections(loaded, input.document);
    const devices = merged.devices;
    const compiled = this.compileWith(network, merged, input.document);
    const summaries = this.summarise(compiled, devices);

    const srcDevice = input.srcDeviceId
      ? devices.find((device) => device.id === input.srcDeviceId)
      : undefined;
    if (input.srcDeviceId && !srcDevice) {
      invalid("source device is not approved in this network");
    }
    const srcIp = input.srcIp ?? srcDevice?.virtualIpv4 ?? "";
    if (!srcIp) invalid("provide a source device or a source IP/CIDR");

    // Find the deciding hop: destination device, or the router serving a CIDR.
    let dstDevice: PolicyDevice | undefined;
    let dstCidr = input.dstCidr;
    if (input.dstDeviceId) {
      dstDevice = devices.find((device) => device.id === input.dstDeviceId);
      if (!dstDevice) invalid("destination device is not approved in this network");
      dstCidr = undefined;
    }
    if (!dstDevice && !dstCidr) invalid("provide a destination device or CIDR");

    const srcAcl = (input.srcDeviceId && compiled.byDevice.get(input.srcDeviceId)?.acl) || {
      aclV1: undefined,
    };

    if (dstDevice) {
      const dstAcl = compiled.byDevice.get(dstDevice.id)?.acl ?? { aclV1: undefined };
      const result = evaluateReachability({
        srcAcl,
        dstAcl,
        srcIp: srcIp.split("/")[0]!,
        dstIp: dstDevice.virtualIpv4,
        protocol: input.protocol,
        ...(input.port !== undefined ? { port: input.port } : {}),
        ...(srcDevice ? { srcTags: srcDevice.tags } : {}),
        dstTags: dstDevice.tags,
      });
      return {
        warnings: compiled.warnings,
        devices: summaries,
        reachability: this.toReachability(result, {
          trace: [
            ...(input.srcDeviceId
              ? [
                  {
                    deviceId: input.srcDeviceId,
                    hostname: srcDevice?.hostname ?? "",
                    chain: result.egress.chain,
                    action: result.egress.action,
                    matchedRule: result.egress.matchedRule,
                    byDefault: result.egress.byDefault,
                  },
                ]
              : []),
            {
              deviceId: dstDevice.id,
              hostname: dstDevice.hostname,
              chain: result.ingress.chain,
              action: result.ingress.action,
              matchedRule: result.ingress.matchedRule,
              byDefault: result.ingress.byDefault,
            },
          ],
          srcIp,
          dstIp: dstDevice.virtualIpv4,
        }),
      };
    }

    const cidr = dstCidr!;
    const router = devices.find((device) =>
      merged.routes.some(
        (route) =>
          route.deviceId === device.id &&
          route.kind === "subnet" &&
          route.state === "approved" &&
          (route.cidr === cidr || route.cidr === normalizeSafe(cidr)),
      ),
    );
    if (!router) {
      throw new AppError(400, `no approved subnet route serves ${cidr}`, "no_route");
    }
    const routerAcl = compiled.byDevice.get(router.id)?.acl ?? { aclV1: undefined };
    const packet = {
      srcIp: srcIp.split("/")[0]!,
      dstIp: cidr.split("/")[0]!,
      protocol: input.protocol,
      ...(input.port !== undefined ? { dstPort: input.port } : {}),
      ...(srcDevice ? { srcGroups: srcDevice.tags } : {}),
    };
    const egress = evaluateChain(srcAcl, "Outbound", packet);
    const forward = evaluateChain(routerAcl, "Forward", packet);
    const allowed = egress.action === "allow" && forward.action === "allow";
    const result: ReachabilityResult = {
      allowed,
      egress,
      ingress: forward,
      explanation: [
        `source outbound: ${egress.action}${egress.matchedRule ? ` (rule ${egress.matchedRule})` : " (default action)"}`,
        `subnet router ${router.hostname} forward: ${forward.action}${forward.matchedRule ? ` (rule ${forward.matchedRule})` : " (default action)"}`,
      ],
    };
    return {
      warnings: compiled.warnings,
      devices: summaries,
      reachability: this.toReachability(result, {
        trace: [
          ...(input.srcDeviceId
            ? [
                {
                  deviceId: input.srcDeviceId,
                  hostname: srcDevice?.hostname ?? "",
                  chain: "Outbound" as const,
                  action: egress.action,
                  matchedRule: egress.matchedRule,
                  byDefault: egress.byDefault,
                },
              ]
            : []),
          {
            deviceId: router.id,
            hostname: router.hostname,
            chain: "Forward" as const,
            action: forward.action,
            matchedRule: forward.matchedRule,
            byDefault: forward.byDefault,
          },
        ],
        srcIp,
        dstIp: cidr,
      }),
    };
  }

  private toReachability(
    result: ReachabilityResult,
    extra: {
      trace: Array<{
        deviceId: string;
        hostname: string;
        chain: "Inbound" | "Outbound" | "Forward";
        action: string;
        matchedRule: string | null;
        byDefault: boolean;
      }>;
      srcIp: string;
      dstIp: string;
    },
  ): ReachabilityDto {
    const deciding = extra.trace.find((hop) => hop.action === "drop");
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
      trace: extra.trace,
      decidedBy: deciding
        ? { deviceId: deciding.deviceId, hostname: deciding.hostname, chain: deciding.chain }
        : extra.trace.length > 0
          ? {
              deviceId: extra.trace[extra.trace.length - 1]!.deviceId,
              hostname: extra.trace[extra.trace.length - 1]!.hostname,
              chain: extra.trace[extra.trace.length - 1]!.chain,
            }
          : null,
      srcIp: extra.srcIp,
      dstIp: extra.dstIp,
    };
  }

  /** "Can A reach B on port P" against the saved policy. */
  async testReachability(
    actor: RequestActor,
    networkId: string,
    input: {
      srcDeviceId?: string;
      srcIp?: string;
      dstDeviceId?: string;
      dstCidr?: string;
      port?: number;
      protocol: "tcp" | "udp" | "icmp" | "icmpv6";
    },
  ): Promise<PreviewResult & { policyVersion: number }> {
    const network = await this.loadNetwork(actor, networkId);
    const active = await this.getActive(networkId);
    if (!active.policy || network.policyMode === "open") {
      throw new AppError(
        409,
        "this network has no active policy; traffic is unrestricted",
        "no_policy",
      );
    }
    const result = await this.preview(actor, networkId, {
      document: normalizePolicyDocument(active.policy.document),
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
    mode: PolicyMode;
  }> {
    const network = await getNetworkById(this.db, networkId);
    const active = await this.getActive(networkId);
    if (!active.policy) {
      return {
        version: 0,
        statements: 0,
        tags: [],
        groups: [],
        mode: network?.policyMode ?? "open",
      };
    }
    return {
      version: active.version,
      ...describePolicy(normalizePolicyDocument(active.policy.document)),
      mode: network?.policyMode ?? active.mode,
    };
  }

  // ------------------------------------------------------------------ tags

  /** Creates (or updates) a tag and audits it, so policy subjects are traceable. */
  async createTag(
    actor: RequestActor,
    input: { name: string; color?: string },
  ): Promise<PolicyTagDto> {
    const tag = await upsertTag(this.db, {
      orgId: actor.orgId,
      name: tagGroupName(input.name),
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
    this.options.realtime?.publish({
      type: "tag.updated",
      orgId: actor.orgId,
      data: { tagId: tag.id, name: tag.name },
    });
    return this.tagDto(actor, tag.id);
  }

  /** A tag with its device assignments, independent of any one network. */
  private async tagDto(actor: RequestActor, tagId: string): Promise<PolicyTagDto> {
    const [tagRows, links, devices, wireguardRows] = await Promise.all([
      listTags(this.db, actor.orgId),
      listDeviceTags(this.db, actor.orgId),
      listDevicesForReconcile(this.db, actor.orgId),
      listOrgWireguardClients(this.db, actor.orgId),
    ]);
    const tag = tagRows.find((row) => row.id === tagId);
    if (!tag) notFound("tag not found");
    const byId = new Map(devices.map((device) => [device.id, device]));
    const assigned: PolicyTagDto["devices"] = links
      .filter((link) => link.tagName === tag.name)
      .map((link) => byId.get(link.deviceId))
      .filter((device): device is NonNullable<typeof device> => Boolean(device))
      .map((device) => ({
        id: device.id,
        name: device.dnsName ?? device.hostname,
        hostname: device.hostname,
        kind: "device" as const,
      }));
    for (const client of wireguardRows) {
      if (
        !client.tags.some(
          (entry) =>
            entry.replace(/^tag:/i, "").toLowerCase() ===
            tag.name.replace(/^tag:/i, "").toLowerCase(),
        )
      ) {
        continue;
      }
      assigned.push({
        id: client.id,
        name: client.name,
        hostname: client.name,
        kind: "wireguard",
      });
    }
    assigned.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    return {
      id: tag.id,
      name: tag.name.replace(/^tag:/, ""),
      subject: tagGroupName(tag.name),
      color: tag.color,
      deviceCount: assigned.length,
      devices: assigned,
    };
  }

  async deleteTag(actor: RequestActor, tagId: string): Promise<void> {
    const removed = await deleteTag(this.db, actor.orgId, tagId);
    if (!removed) notFound("tag not found");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "tag.deleted",
      targetType: "tag",
      targetId: tagId,
      metadata: {},
    });
    this.options.realtime?.publish({
      type: "tag.updated",
      orgId: actor.orgId,
      data: { tagId, deleted: true },
    });
  }

  /** Bulk assignment: exactly these devices carry the tag afterwards. */
  async assignTag(
    actor: RequestActor,
    tagId: string,
    deviceIds: string[],
  ): Promise<PolicyTagDto> {
    const tags = await listTags(this.db, actor.orgId);
    const tag = tags.find((row) => row.id === tagId);
    if (!tag) notFound("tag not found");
    const devices = await listDevicesForReconcile(this.db, actor.orgId);
    const byId = new Map(devices.map((device) => [device.id, device]));
    for (const deviceId of deviceIds) {
      if (!byId.has(deviceId)) invalid(`device ${deviceId} is not in this organisation`);
    }
    await setTagDevices(this.db, tagId, deviceIds);
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "tag.devices_updated",
      targetType: "tag",
      targetId: tagId,
      metadata: { name: tag.name, deviceCount: deviceIds.length },
    });
    this.options.realtime?.publish({
      type: "tag.updated",
      orgId: actor.orgId,
      data: { tagId, name: tag.name, deviceCount: deviceIds.length },
    });
    return this.tagDto(actor, tagId);
  }

  // ------------------------------------------------------------- user groups

  async listUserGroups(actor: RequestActor): Promise<PolicyUserGroupDto[]> {
    const [users, groupRows, groupMembers, deviceRows, links] = await Promise.all([
      listUsers(this.db, actor.orgId),
      listUserGroups(this.db, actor.orgId),
      listUserGroupMembers(this.db, actor.orgId),
      listDevicesForReconcile(this.db, actor.orgId),
      listDeviceTags(this.db, actor.orgId),
    ]);
    void links;
    const devices: PolicyDevice[] = deviceRows
      .filter((device) => device.state === "approved" && device.virtualIpv4)
      .map((device) => ({
        id: device.id,
        hostname: device.dnsName ?? device.hostname,
        virtualIpv4: device.virtualIpv4 ?? "",
        ownerUserId: device.ownerUserId,
        tags: [],
      }));
    const policyUsers: PolicyUser[] = users.map((user) => ({
      id: user.id,
      email: user.email,
      groups: user.groups,
    }));
    return this.groupDtos(
      policyUsers,
      groupRows.map((row) => ({
        id: row.id,
        name: row.name,
        source: row.source,
        oidcValue: row.oidcValue,
        color: row.color,
      })),
      groupMembers,
      syncedGroups(users),
      devices,
    );
  }

  /** All tags of the organisation with their device assignments. */
  async listTags(actor: RequestActor): Promise<PolicyTagDto[]> {
    const tagRows = await listTags(this.db, actor.orgId);
    return Promise.all(tagRows.map((tag) => this.tagDto(actor, tag.id)));
  }

  async createUserGroup(
    actor: RequestActor,
    input: { name: string; members?: string[]; source?: "manual" | "oidc" },
  ): Promise<PolicyUserGroupDto> {
    const name = input.name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(name)) {
      invalid("user group names must be letters, digits, dots, underscores or dashes");
    }
    if (input.source === "oidc") {
      // Synced groups are derived from the IdP claim; creating a row is only a
      // declaration of which claim value to expose. Reject a value no user has
      // yet, because it would silently match nobody.
      const users = await listUsers(this.db, actor.orgId);
      const known = new Set(users.flatMap((user) => user.groups));
      if (!known.has(name)) {
        invalid(
          `no known user has the identity-provider group "${name}"; ask a user to sign in first`,
        );
      }
    }
    const row = await upsertUserGroup(this.db, {
      orgId: actor.orgId,
      name,
      source: input.source ?? "manual",
      oidcValue: input.source === "oidc" ? name : "",
      createdBy: actor.userId,
    });
    if ((input.source ?? "manual") === "manual") {
      await replaceUserGroupMembers(this.db, row.id, input.members ?? []);
    }
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "user_group.created",
      targetType: "user_group",
      targetId: row.id,
      metadata: { name: row.name, source: row.source, members: input.members?.length ?? 0 },
    });
    this.options.realtime?.publish({
      type: "user_group.updated",
      orgId: actor.orgId,
      data: { groupId: row.id, name: row.name },
    });
    const catalog = await this.catalog(actor);
    const dto = catalog.userGroups.find(
      (entry) => entry.name === name && entry.source === row.source,
    );
    if (!dto) throw new AppError(500, "failed to read the user group back");
    return dto;
  }

  async deleteUserGroup(actor: RequestActor, groupId: string): Promise<void> {
    if (groupId.startsWith("oidc:")) {
      throw new AppError(
        409,
        "synced user groups are derived from the identity provider and cannot be deleted here",
        "read_only",
      );
    }
    const group = await getUserGroup(this.db, actor.orgId, groupId);
    if (!group) notFound("user group not found");
    if (group.source === "oidc") {
      throw new AppError(
        409,
        "synced user groups are derived from the identity provider and cannot be deleted here",
        "read_only",
      );
    }
    await deleteUserGroup(this.db, actor.orgId, groupId);
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "user_group.deleted",
      targetType: "user_group",
      targetId: groupId,
      metadata: { name: group.name },
    });
    this.options.realtime?.publish({
      type: "user_group.updated",
      orgId: actor.orgId,
      data: { groupId, name: group.name, deleted: true },
    });
  }

  async addUserGroupMember(
    actor: RequestActor,
    groupId: string,
    email: string,
  ): Promise<PolicyUserGroupDto> {
    if (groupId.startsWith("oidc:")) {
      throw new AppError(409, "synced user groups are read-only", "read_only");
    }
    const group = await getUserGroup(this.db, actor.orgId, groupId);
    if (!group) notFound("user group not found");
    if (group.source === "oidc") {
      throw new AppError(409, "synced user groups are read-only", "read_only");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      invalid("member must be an email address");
    }
    await addUserGroupMember(this.db, groupId, email);
    await this.auditGroupChange(actor, group.id, group.name, "user_group.member_added", {
      email: email.trim().toLowerCase(),
    });
    const catalog = await this.catalog(actor);
    const dto = catalog.userGroups.find((entry) => entry.id === groupId);
    if (!dto) throw new AppError(500, "failed to read the user group back");
    return dto;
  }

  async removeUserGroupMember(
    actor: RequestActor,
    groupId: string,
    email: string,
  ): Promise<PolicyUserGroupDto> {
    if (groupId.startsWith("oidc:")) {
      throw new AppError(409, "synced user groups are read-only", "read_only");
    }
    const group = await getUserGroup(this.db, actor.orgId, groupId);
    if (!group) notFound("user group not found");
    if (group.source === "oidc") {
      throw new AppError(409, "synced user groups are read-only", "read_only");
    }
    const removed = await removeUserGroupMember(this.db, groupId, email);
    if (!removed) notFound("member not found");
    await this.auditGroupChange(actor, group.id, group.name, "user_group.member_removed", {
      email: email.trim().toLowerCase(),
    });
    const catalog = await this.catalog(actor);
    const dto = catalog.userGroups.find((entry) => entry.id === groupId);
    if (!dto) throw new AppError(500, "failed to read the user group back");
    return dto;
  }

  private async auditGroupChange(
    actor: RequestActor,
    groupId: string,
    name: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action,
      targetType: "user_group",
      targetId: groupId,
      metadata: { name, ...metadata },
    });
    this.options.realtime?.publish({
      type: "user_group.updated",
      orgId: actor.orgId,
      data: { groupId, name },
    });
  }

  // ---------------------------------------------------------------- catalog

  /** Everything the subject pickers need, derived from current network state. */
  async catalog(actor: RequestActor, networkId?: string): Promise<PolicyCatalog> {
    const network = networkId
      ? await this.loadNetwork(actor, networkId)
      : (await this.firstNetwork(actor)) ?? null;
    if (!network) {
      return { devices: [], tags: [], userGroups: [], subnets: [], hosts: [] };
    }
    const loaded = await this.loadInput(network);
    return this.buildCatalog(loaded, network);
  }

  private async firstNetwork(actor: RequestActor): Promise<Network | undefined> {
    const rows = await this.db.query.networks.findMany({
      where: (table, { eq }) => eq(table.orgId, actor.orgId),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
      limit: 1,
    });
    return rows[0];
  }

  private buildCatalog(loaded: LoadedInput, network: Network): PolicyCatalog {
    const deviceById = new Map(loaded.deviceRows.map((row) => [row.id, row]));
    const tagsByDevice = new Map<string, string[]>();
    for (const link of loaded.tagLinks) {
      const list = tagsByDevice.get(link.deviceId) ?? [];
      list.push(link.tagName);
      tagsByDevice.set(link.deviceId, list);
    }
    const devices: PolicyCatalog["devices"] = loaded.deviceRows
      .filter((row) => row.networkId === network.id)
      .map((row) => ({
        id: row.id,
        name: row.dnsName ?? row.hostname,
        hostname: row.hostname,
        virtualIpv4: row.virtualIpv4,
        state: row.state,
        tags: (tagsByDevice.get(row.id) ?? []).map((tag) => tag.replace(/^tag:/, "")),
        kind: "device" as const,
      }));
    for (const client of loaded.wireguardRows) {
      devices.push({
        id: client.id,
        name: client.name,
        hostname: client.name,
        virtualIpv4: client.virtualIpv4,
        state: "approved",
        tags: client.tags.map((tag) => tag.replace(/^tag:/, "")),
        kind: "wireguard",
      });
    }
    devices.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );

    const devicesByTag = new Map<
      string,
      Array<{
        id: string;
        name: string;
        hostname: string;
        kind?: "device" | "wireguard";
      }>
    >();
    for (const [deviceId, tagNames] of tagsByDevice) {
      const row = deviceById.get(deviceId);
      if (!row || row.networkId !== network.id) continue;
      const entry = {
        id: row.id,
        name: row.dnsName ?? row.hostname,
        hostname: row.hostname,
        kind: "device" as const,
      };
      for (const tag of tagNames) {
        const list = devicesByTag.get(tag) ?? [];
        list.push(entry);
        devicesByTag.set(tag, list);
      }
    }
    for (const client of loaded.wireguardRows) {
      const entry = {
        id: client.id,
        name: client.name,
        hostname: client.name,
        kind: "wireguard" as const,
      };
      for (const tag of client.tags) {
        const key = tagGroupName(tag);
        const list = devicesByTag.get(key) ?? [];
        list.push(entry);
        devicesByTag.set(key, list);
      }
    }
    const tags: PolicyTagDto[] = loaded.tagRows.map((tag) => {
      const assigned = (devicesByTag.get(tag.name) ?? []).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      return {
        id: tag.id,
        name: tag.name.replace(/^tag:/, ""),
        subject: tagGroupName(tag.name),
        color: tag.color,
        deviceCount: assigned.length,
        devices: assigned,
      };
    });

    const groupEntries = this.groupDtos(
      loaded.users,
      loaded.groupRows,
      loaded.groupMembers,
      syncedGroups(
        loaded.users.map((user) => ({
          email: user.email,
          groups: user.groups,
        })) as unknown as User[],
      ),
      loaded.devices,
    );

    const subnets: PolicySubnetDto[] = [];
    const seenCidrs = new Set<string>();
    for (const subnet of loaded.subnets) {
      const route = loaded.routeRows.find(
        (row) =>
          row.kind === "subnet" &&
          row.state === "approved" &&
          row.cidr === subnet.cidr,
      );
      const viaDeviceId = subnet.viaDeviceId ?? route?.deviceId ?? null;
      const via =
        (viaDeviceId ? deviceById.get(viaDeviceId) : undefined) ??
        (subnet.via
          ? loaded.deviceRows.find(
              (row) => (row.dnsName ?? row.hostname).toLowerCase() === subnet.via!.toLowerCase(),
            )
          : undefined);
      const viaName = via ? (via.dnsName ?? via.hostname) : (subnet.via ?? "unassigned");
      const alias = subnet.name;
      if (seenCidrs.has(`${alias}|${subnet.cidr}`)) continue;
      seenCidrs.add(`${alias}|${subnet.cidr}`);
      subnets.push({
        id: alias,
        name: alias,
        display: `${subnet.cidr} via ${viaName}`,
        cidr: subnet.cidr,
        viaDeviceId: via?.id ?? null,
        viaHostname: viaName,
        routeId: route?.id ?? null,
        approved: Boolean(route),
      });
    }
    subnets.sort((left, right) => left.cidr.localeCompare(right.cidr));

    const hosts = Object.entries(loaded.document?.hosts ?? {}).map(([alias, value]) => ({
      alias,
      subject: `host:${alias}`,
      value,
    }));
    return { devices, tags, userGroups: groupEntries, subnets, hosts };
  }

  /** User-group DTOs for a given device set (one network or the whole org). */
  private groupDtos(
    users: readonly PolicyUser[],
    groupRows: LoadedInput["groupRows"],
    groupMembers: LoadedInput["groupMembers"],
    synced: PolicyUserGroupInput[],
    devices: readonly PolicyDevice[],
  ): PolicyUserGroupDto[] {
    const membersByGroup = new Map<string, string[]>();
    for (const member of groupMembers) {
      const list = membersByGroup.get(member.groupId) ?? [];
      list.push(member.email);
      membersByGroup.set(member.groupId, list);
    }
    const usersById = new Map(users.map((user) => [user.id, user]));
    const devicesOwnedBy = (members: string[]) =>
      devices.filter((device) => {
        const owner = device.ownerUserId ? usersById.get(device.ownerUserId) : undefined;
        return owner ? members.includes(owner.email.toLowerCase()) : false;
      });
    const groupEntries: PolicyUserGroupDto[] = [];
    for (const group of groupRows) {
      const members =
        group.source === "manual"
          ? (membersByGroup.get(group.id) ?? [])
          : (synced.find((entry) => entry.name === group.name)?.members ?? []);
      const groupDevices = devicesOwnedBy(members);
      groupEntries.push({
        id: group.id,
        name: group.name,
        subject: userGroupName(group.name),
        source: group.source,
        readOnly: group.source === "oidc",
        color: group.color,
        members: members.map((email) => ({
          email,
          displayName:
            users.find((user) => user.email.toLowerCase() === email)?.email ?? null,
          inOrganisation: users.some((user) => user.email.toLowerCase() === email),
        })),
        peopleCount: members.length,
        deviceCount: groupDevices.length,
        devices: groupDevices.map((device) => ({
          id: device.id,
          name: device.hostname,
        })),
      });
    }
    const rowGroupNames = new Set(groupRows.map((group) => group.name));
    for (const group of synced) {
      if (rowGroupNames.has(group.name)) continue;
      const groupDevices = devicesOwnedBy(group.members);
      groupEntries.push({
        id: `oidc:${group.name}`,
        name: group.name,
        subject: userGroupName(group.name),
        source: "oidc",
        readOnly: true,
        color: "",
        members: group.members.map((email) => ({
          email,
          displayName:
            users.find((user) => user.email.toLowerCase() === email)?.email ?? null,
          inOrganisation: true,
        })),
        peopleCount: group.members.length,
        deviceCount: groupDevices.length,
        devices: groupDevices.map((device) => ({ id: device.id, name: device.hostname })),
      });
    }
    groupEntries.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    return groupEntries;
  }

  // ------------------------------------------------------------------ views

  /** Structured rules for GET /policy: index, name, subjects and counts. */
  ruleViews(
    document: PolicyDocument,
    statements: readonly ResolvedStatement[],
    loaded: LoadedInput,
    network: Network,
  ): PolicyRuleView[] {
    const catalog = this.buildCatalog(loaded, network);
    return document.rules.map((rule, index) => {
      const statement = statements.find((entry) => entry.index === index);
      const affected = statement
        ? this.affectedDeviceIds(statement, loaded)
        : new Set<string>();
      return {
        index,
        name: rule.name ?? null,
        enabled: rule.enabled !== false,
        action: rule.action,
        protocol: rule.protocol,
        ports: rule.ports,
        sourcePorts: rule.sourcePorts,
        stateful: rule.stateful,
        rateLimit: rule.rateLimit ?? null,
        burst: rule.burst ?? null,
        from: rule.from.map((subject) => subjectView(subject, catalog, "from")),
        to: rule.to.map((subject) => subjectView(subject, catalog, "to")),
        affectedDeviceCount: affected.size,
      };
    });
  }

  private affectedDeviceIds(
    statement: ResolvedStatement,
    loaded: LoadedInput,
  ): Set<string> {
    const ids = new Set<string>(statement.srcDevices.map((device) => device.id));
    for (const entry of statement.dst) {
      if (entry.kind === "device") ids.add(entry.device.id);
    }
    for (const route of loaded.routeRows) {
      if (route.kind !== "subnet" || route.state !== "approved") continue;
      if (statement.srcSubnets.some((subnet) => subnet.cidr === route.cidr)) {
        ids.add(route.deviceId);
      }
      if (
        statement.dst.some(
          (entry) =>
            (entry.kind === "subnet" || entry.kind === "cidr") &&
            entry.cidr === route.cidr,
        )
      ) {
        ids.add(route.deviceId);
      }
    }
    return ids;
  }

  // ------------------------------------------------------------- compiled ACL

  /** The exact EasyTier ACL EasyPlane would push to one device. */
  async compiledAcl(
    actor: RequestActor,
    networkId: string,
    deviceId: string,
  ): Promise<CompiledAclDto> {
    const network = await this.loadNetwork(actor, networkId);
    const device = await getDeviceById(this.db, deviceId);
    if (!device || device.networkId !== network.id) notFound("device not found");
    const loaded = await this.loadInput(network);
    if (!loaded.document) {
      return {
        deviceId,
        hostname: device.dnsName ?? device.hostname,
        virtualIpv4: device.virtualIpv4,
        enabled: false,
        policyVersion: 0,
        mode: network.policyMode,
        chains: [],
        group: { declares: [], members: [] },
        hash: "",
      };
    }
    const compiled = this.compileWith(network, loaded, loaded.document);
    const compiledAclValue = compiled.byDevice.get(deviceId)?.acl;
    return {
      deviceId,
      hostname: device.dnsName ?? device.hostname,
      virtualIpv4: device.virtualIpv4,
      enabled: Boolean(compiledAclValue) && network.policyMode !== "open",
      policyVersion: network.policyMode === "open" ? 0 : network.policyVersion,
      mode: network.policyMode,
      chains: (network.policyMode === "open" ? [] : (compiledAclValue?.aclV1?.chains ?? [])).map((chain) => ({
        name: chain.name,
        chainType:
          chain.chainType === acl.ChainType.Inbound
            ? "Inbound"
            : chain.chainType === acl.ChainType.Outbound
              ? "Outbound"
              : "Forward",
        enabled: chain.enabled,
        defaultAction: chain.defaultAction === acl.Action.Allow ? "Allow" : "Drop",
        rules: chain.rules.map((rule) => ({
          name: rule.name,
          description: rule.description,
          priority: rule.priority,
          enabled: rule.enabled,
          protocol: acl.Protocol[rule.protocol] ?? "Unspecified",
          ports: rule.ports,
          sourceIps: rule.sourceIps,
          destinationIps: rule.destinationIps,
          sourcePorts: rule.sourcePorts,
          action: rule.action === acl.Action.Allow ? "Allow" : "Drop",
          rateLimit: rule.rateLimit,
          burstLimit: rule.burstLimit,
          stateful: rule.stateful,
          sourceGroups: rule.sourceGroups,
          destinationGroups: rule.destinationGroups,
        })),
      })),
      group: {
        declares: (compiledAclValue?.aclV1?.group?.declares ?? []).map((entry) => ({
          groupName: entry.groupName,
        })),
        members: compiledAclValue?.aclV1?.group?.members ?? [],
      },
      hash: compiledAclValue ? shortHash(canonicalAcl(compiledAclValue)) : "",
    };
  }
}

function normalizeSafe(value: string): string {
  try {
    return normalizeCidr(value);
  } catch {
    return value;
  }
}

/** Resolves a subject reference to its display form and counts. */
export function subjectView(
  subject: string,
  catalog: PolicyCatalog,
  side: "from" | "to",
): SubjectView {
  if (
    subject === "*" ||
    subject === "anyone" ||
    subject === "anywhere" ||
    subject === "autogroup:all"
  ) {
    return {
      subject: "*",
      kind: "any",
      id: "*",
      name: side === "from" ? "Anyone" : "Anywhere",
      display: side === "from" ? "Anyone" : "Anywhere",
      deviceCount: catalog.devices.length,
    };
  }
  if (subject.startsWith("tag:")) {
    const name = subject.slice("tag:".length);
    const tag = catalog.tags.find((entry) => entry.name === name);
    return {
      subject,
      kind: "tag",
      id: subject,
      name,
      display: name,
      detail: `${tag?.deviceCount ?? 0} ${tag?.deviceCount === 1 ? "device" : "devices"}`,
      deviceCount: tag?.deviceCount ?? 0,
    };
  }
  if (subject.startsWith("group:")) {
    const name = subject.slice("group:".length);
    const group = catalog.userGroups.find((entry) => entry.name === name);
    return {
      subject,
      kind: "group",
      id: group?.id ?? subject,
      name,
      display: name,
      detail: group
        ? `${group.peopleCount} ${group.peopleCount === 1 ? "person" : "people"}, ${group.deviceCount} ${group.deviceCount === 1 ? "device" : "devices"}`
        : "unknown group",
      deviceCount: group?.deviceCount ?? 0,
      ...(group?.peopleCount !== undefined ? { peopleCount: group.peopleCount } : {}),
      ...(group ? { readOnly: group.readOnly, source: group.source } : {}),
    };
  }
  if (subject.startsWith("subnet:")) {
    const alias = subject.slice("subnet:".length);
    const subnet = catalog.subnets.find((entry) => entry.name === alias);
    return {
      subject,
      kind: "subnet",
      id: subnet?.id ?? subject,
      name: subnet?.name ?? alias,
      display: subnet?.name ?? alias,
      detail: subnet?.display ?? "unknown subnet",
      deviceCount: subnet?.viaDeviceId ? 1 : 0,
    };
  }
  if (subject.startsWith("host:")) {
    const alias = subject.slice("host:".length);
    const host = catalog.hosts.find((entry) => entry.alias === alias);
    return {
      subject,
      kind: "host",
      id: subject,
      name: alias,
      display: alias,
      detail: host?.value ?? "unknown host alias",
      deviceCount: 0,
    };
  }
  if (subject.startsWith("cidr:")) {
    const value = subject.slice("cidr:".length);
    return {
      subject,
      kind: "cidr",
      id: subject,
      name: value,
      display: value,
      detail: "custom IP/CIDR",
      deviceCount: 0,
    };
  }
  const name = subject.startsWith("device:")
    ? subject.slice("device:".length)
    : subject;
  const device = catalog.devices.find(
    (entry) => entry.name.toLowerCase() === name.toLowerCase(),
  );
  return {
    subject,
    kind: "device",
    id: device?.id ?? subject,
    name: device?.name ?? name,
    display: device?.name ?? name,
    detail: device?.virtualIpv4 ?? "not approved",
    deviceCount: device ? 1 : 0,
  };
}

// Re-exported for route modules that used the old service helpers.
export type { PolicyUserGroupInput, PolicySubnetInput };
