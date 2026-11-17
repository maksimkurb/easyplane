import { ipv4ToHostCidr, normalizeCidr } from "../routes.js";
import {
  isIpOrCidr,
  subjectKind,
  type PolicyDocument,
  type PolicyProtocol,
  type PolicyRule,
} from "./document.js";

/**
 * Expansion of policy subjects into concrete devices, CIDRs and subnets.
 *
 * Resolution is strict when a policy is saved or previewed (unknown names are
 * errors) and lenient when a config is compiled for an online device (a device,
 * tag or subnet can disappear between two pushes; that must not wedge the
 * network).
 *
 * Two distinct subject families are expanded here:
 *
 * - `tag:` is a label on **devices**;
 * - `group:` is a set of **people** (manual members or a synced IdP claim), and
 *   matches the devices those people own.
 *
 * Both end up as EasyTier groups in the compiled rules, but they are never
 * interchangeable in the document or the API.
 */

export interface PolicyDevice {
  id: string;
  /** Unique DNS label inside the network. */
  hostname: string;
  virtualIpv4: string;
  ownerUserId: string | null;
  /** Bare or namespaced tag names; normalized to `tag:...` here. */
  tags: string[];
}

export interface PolicyUser {
  id: string;
  email: string;
  groups: string[];
}

export interface PolicyRouteInput {
  deviceId: string;
  kind: "subnet" | "exit_node";
  cidr: string;
  state: "pending" | "approved" | "rejected";
}

/** A named subnet from an approved route or the document's `subnets` section. */
export interface PolicySubnetInput {
  /** Bare alias (`home-lan`). */
  name: string;
  cidr: string;
  /** Router device id when an approved route names one. */
  viaDeviceId: string | null;
  /** Device name from the document's `via`, when not resolved to an id. */
  via?: string;
  /** True when an approved subnet route backs this alias. */
  approved?: boolean;
}

export interface PolicyUserGroupInput {
  /** Bare name (`admins`). */
  name: string;
  source: "manual" | "oidc";
  /** Emails and, for v1 compatibility, IdP group names. */
  members: string[];
}

export interface ResolveInput {
  document: PolicyDocument;
  devices: readonly PolicyDevice[];
  users: readonly PolicyUser[];
  knownTags: readonly string[];
  routes: readonly PolicyRouteInput[];
  /** Named subnets (from approved routes and the document). */
  subnets?: readonly PolicySubnetInput[];
  /** User groups (manual rows plus synced IdP groups). */
  userGroups?: readonly PolicyUserGroupInput[];
}

export type ResolvedDst =
  | { kind: "device"; device: PolicyDevice; ports: string[] }
  | { kind: "cidr"; cidr: string; ports: string[] }
  | {
      kind: "subnet";
      cidr: string;
      /** Router device id when the subnet has an approved route. */
      viaDeviceId: string | null;
      alias: string;
      ports: string[];
    };

export interface ResolvedStatement {
  index: number;
  /** Stored name, or `rule-<n>` when the rule is unnamed. */
  name: string;
  action: "allow" | "deny";
  protocol: PolicyProtocol;
  rateLimit: number;
  burst: number;
  stateful: boolean;
  enabled: boolean;
  ports: string[];
  sourcePorts: string[];
  srcDevices: PolicyDevice[];
  /** `cidr:`, `host:` and raw sources. */
  srcCidrs: string[];
  /** `subnet:` sources and the router that serves them. */
  srcSubnets: Array<{ alias: string; cidr: string; viaDeviceId: string | null }>;
  dst: ResolvedDst[];
  /** Tag subjects in `from`, used for strict group matching. */
  srcTags: string[];
  /** User-group subjects in `from`. */
  srcGroups: string[];
  /** Tag and user-group subjects in `to`. */
  dstGroups: string[];
  raw: PolicyRule;
}

export interface ResolveResult {
  statements: ResolvedStatement[];
  warnings: string[];
  /** Tags referenced by the document (validated against `knownTags`). */
  referencedTags: string[];
  /** EasyTier group memberships per device (`tag:x`, `group:y`). */
  groupsByDevice: Map<string, string[]>;
}

export class SubjectResolutionError extends Error {
  constructor(readonly issues: string[]) {
    super("policy references unknown tags, groups, devices or subnets");
    this.name = "SubjectResolutionError";
  }
}

/** Normalizes any tag spelling to the EasyTier group name `tag:<name>`. */
export function tagGroupName(tag: string): string {
  return tag.startsWith("tag:") ? tag.toLowerCase() : `tag:${tag.toLowerCase()}`;
}

/** `admins`, `group:admins` -> `group:admins`. */
export function userGroupName(name: string): string {
  return name.startsWith("group:") ? name.toLowerCase() : `group:${name.toLowerCase()}`;
}

function normalizeUserGroups(input: ResolveInput): PolicyUserGroupInput[] {
  if (input.userGroups) return [...input.userGroups];
  return Object.entries(input.document.userGroups ?? {}).map(([name, group]) => ({
    name: name.startsWith("group:") ? name.slice("group:".length) : name,
    source: group.source,
    members: group.members,
  }));
}

function matchUser(group: PolicyUserGroupInput, user: PolicyUser): boolean {
  return group.members.some((member) => {
    const value = member.trim().toLowerCase();
    if (value.includes("@")) return value === user.email.toLowerCase();
    // v1 compatibility: a bare member matched an IdP group name.
    return user.groups.some((entry) => entry.toLowerCase() === value);
  });
}

export function resolvePolicy(
  input: ResolveInput,
  options: { strict: boolean },
): ResolveResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const knownTags = new Set([...input.knownTags].map(tagGroupName));
  const approved = input.devices.filter((device) => device.virtualIpv4 !== "");
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const document = input.document;
  const userGroups = normalizeUserGroups(input);
  const groupsByName = new Map(
    userGroups.map((group) => [userGroupName(group.name), group]),
  );
  const subnets = new Map<string, PolicySubnetInput>();
  for (const subnet of input.subnets ?? []) {
    subnets.set(subnet.name.toLowerCase(), subnet);
  }
  for (const [alias, subnet] of Object.entries(document.subnets)) {
    if (!subnets.has(alias.toLowerCase())) {
      subnets.set(alias.toLowerCase(), {
        name: alias,
        cidr: subnet.cidr,
        viaDeviceId: null,
        approved: false,
        ...(subnet.via ? { via: subnet.via } : {}),
      });
    }
  }
  const deviceByName = new Map(
    approved.map((device) => [device.hostname.toLowerCase(), device]),
  );

  function devicesForGroup(groupName: string): PolicyDevice[] {
    const group = groupsByName.get(groupName);
    if (!group) {
      if (options.strict) issues.push(`unknown user group "${groupName}"`);
      else warnings.push(`unknown user group "${groupName}"`);
      return [];
    }
    return approved.filter((device) => {
      if (!device.ownerUserId) return false;
      const user = usersById.get(device.ownerUserId);
      if (!user) return false;
      return matchUser(group, user);
    });
  }

  function resolveSubnet(alias: string, label: string): PolicySubnetInput | null {
    const subnet = subnets.get(alias.toLowerCase());
    if (!subnet) {
      if (options.strict) issues.push(`${label}: subnet "${alias}" does not exist`);
      else warnings.push(`subnet "${alias}" does not exist`);
      return null;
    }
    if (options.strict && subnet.approved === false) {
      issues.push(
        `${label}: subnet "${alias}" (${subnet.cidr}) has no approved subnet route`,
      );
    }
    try {
      return {
        ...subnet,
        cidr: normalizeCidrOrKeep(subnet.cidr),
        viaDeviceId:
          subnet.viaDeviceId ??
          (subnet.via ? deviceByName.get(subnet.via.toLowerCase())?.id : undefined) ??
          null,
      };
    } catch {
      issues.push(`${label}: subnet "${alias}" has an invalid CIDR "${subnet.cidr}"`);
      return null;
    }
  }

  function resolveSrcSubject(
    subject: string,
    label: string,
  ): {
    devices: PolicyDevice[];
    cidrs: string[];
    tags: string[];
    groups: string[];
    subnets: Array<{ alias: string; cidr: string; viaDeviceId: string | null }>;
  } {
    const empty = {
      devices: [] as PolicyDevice[],
      cidrs: [] as string[],
      tags: [] as string[],
      groups: [] as string[],
      subnets: [] as Array<{ alias: string; cidr: string; viaDeviceId: string | null }>,
    };
    const kind = subjectKind(subject);
    switch (kind) {
      case "all":
        return { ...empty, devices: approved };
      case "tag": {
        if (!knownTags.has(tagGroupName(subject))) {
          if (options.strict) issues.push(`${label}: tag "${subject}" does not exist`);
          else warnings.push(`tag "${subject}" does not exist`);
          return empty;
        }
        const devices = approved.filter((device) =>
          device.tags.map(tagGroupName).includes(tagGroupName(subject)),
        );
        return { ...empty, devices, tags: [tagGroupName(subject)] };
      }
      case "group": {
        const name = userGroupName(subject);
        return {
          ...empty,
          devices: devicesForGroup(name),
          groups: [name],
        };
      }
      case "device": {
        const name = subject.startsWith("device:")
          ? subject.slice("device:".length)
          : subject;
        const device = deviceByName.get(name.toLowerCase());
        if (!device) {
          if (options.strict) {
            issues.push(`${label}: device "${name}" is not an approved device`);
          } else {
            warnings.push(`device "${name}" is not approved`);
          }
          return empty;
        }
        return { ...empty, devices: [device] };
      }
      case "host": {
        const alias = subject.slice("host:".length);
        const value = document.hosts[alias];
        if (!value) {
          if (options.strict) issues.push(`${label}: host alias "${alias}" is undefined`);
          return empty;
        }
        if (!isIpOrCidr(value)) {
          issues.push(`${label}: host alias "${alias}" is not a valid IP/CIDR`);
          return empty;
        }
        return { ...empty, cidrs: [normalizeCidrOrKeep(value)] };
      }
      case "subnet": {
        const alias = subject.slice("subnet:".length);
        const subnet = resolveSubnet(alias, label);
        if (!subnet) return empty;
        return {
          ...empty,
          subnets: [
            {
              alias: subnet.name,
              cidr: subnet.cidr,
              viaDeviceId:
                subnet.viaDeviceId ??
                (subnet.via ? deviceByName.get(subnet.via.toLowerCase())?.id : undefined) ??
                null,
            },
          ],
        };
      }
      case "cidr": {
        const value = subject.slice("cidr:".length);
        if (!isIpOrCidr(value)) {
          issues.push(`${label}: "${value}" is not a valid IP/CIDR`);
          return empty;
        }
        return { ...empty, cidrs: [normalizeCidrOrKeep(value)] };
      }
      default:
        issues.push(`${label}: unknown subject "${subject}"`);
        return empty;
    }
  }

  function resolveDstSubject(
    subject: string,
    ports: string[],
    label: string,
  ): ResolvedDst[] {
    const kind = subjectKind(subject);
    switch (kind) {
      case "all":
        return approved.map((device) => ({ kind: "device" as const, device, ports }));
      case "tag": {
        if (!knownTags.has(tagGroupName(subject))) {
          if (options.strict) issues.push(`${label}: tag "${subject}" does not exist`);
          else warnings.push(`tag "${subject}" does not exist`);
          return [];
        }
        return approved
          .filter((device) =>
            device.tags.map(tagGroupName).includes(tagGroupName(subject)),
          )
          .map((device) => ({ kind: "device" as const, device, ports }));
      }
      case "group": {
        const name = userGroupName(subject);
        return devicesForGroup(name).map((device) => ({
          kind: "device" as const,
          device,
          ports,
        }));
      }
      case "device": {
        const name = subject.startsWith("device:")
          ? subject.slice("device:".length)
          : subject;
        const device = deviceByName.get(name.toLowerCase());
        if (!device) {
          if (options.strict) {
            issues.push(`${label}: device "${name}" is not an approved device`);
          } else {
            warnings.push(`device "${name}" is not approved`);
          }
          return [];
        }
        return [{ kind: "device", device, ports }];
      }
      case "host": {
        const alias = subject.slice("host:".length);
        const value = document.hosts[alias];
        if (!value) {
          if (options.strict) issues.push(`${label}: host alias "${alias}" is undefined`);
          return [];
        }
        if (!isIpOrCidr(value)) {
          issues.push(`${label}: host alias "${alias}" is not a valid IP/CIDR`);
          return [];
        }
        return [{ kind: "cidr", cidr: normalizeCidrOrKeep(value), ports }];
      }
      case "subnet": {
        const alias = subject.slice("subnet:".length);
        const subnet = resolveSubnet(alias, label);
        if (!subnet) return [];
        return [
          {
            kind: "subnet",
            cidr: subnet.cidr,
            viaDeviceId: subnet.viaDeviceId,
            alias: subnet.name,
            ports,
          },
        ];
      }
      case "cidr": {
        const value = subject.slice("cidr:".length);
        if (!isIpOrCidr(value)) {
          issues.push(`${label}: "${value}" is not a valid IP/CIDR`);
          return [];
        }
        return [{ kind: "cidr", cidr: normalizeCidrOrKeep(value), ports }];
      }
      default:
        issues.push(`${label}: unknown destination "${subject}"`);
        return [];
    }
  }

  const statements: ResolvedStatement[] = [];
  const referencedTags = new Set<string>();

  document.rules.forEach((rule, index) => {
    const label = rule.name ?? `rules[${index}]`;
    let srcDevices: PolicyDevice[] = [];
    const srcCidrs = new Set<string>();
    const srcTags = new Set<string>();
    const srcGroups = new Set<string>();
    const srcSubnets = new Map<
      string,
      { alias: string; cidr: string; viaDeviceId: string | null }
    >();
    for (const subject of rule.from) {
      const resolved = resolveSrcSubject(subject, label);
      srcDevices = srcDevices.concat(resolved.devices);
      for (const cidr of resolved.cidrs) srcCidrs.add(cidr);
      for (const tag of resolved.tags) {
        srcTags.add(tag);
        referencedTags.add(tag);
      }
      for (const group of resolved.groups) srcGroups.add(group);
      for (const subnet of resolved.subnets) srcSubnets.set(subnet.alias, subnet);
    }
    // Stable de-duplication by device id.
    const seen = new Set<string>();
    srcDevices = srcDevices.filter((device) => {
      if (seen.has(device.id)) return false;
      seen.add(device.id);
      return true;
    });

    const dst: ResolvedDst[] = [];
    const dstGroups = new Set<string>();
    for (const subject of rule.to) {
      const kind = subjectKind(subject);
      if (kind === "tag") dstGroups.add(tagGroupName(subject));
      if (kind === "group") dstGroups.add(userGroupName(subject));
      if (kind === "tag") referencedTags.add(tagGroupName(subject));
      dst.push(...resolveDstSubject(subject, rule.ports, label));
    }

    if (srcDevices.length === 0 && srcCidrs.size === 0 && srcSubnets.size === 0) {
      warnings.push(`${label}: no source devices match`);
    }
    if (dst.length === 0) warnings.push(`${label}: no destination devices match`);

    statements.push({
      index,
      name: rule.name ?? `rule-${index + 1}`,
      action: rule.action,
      protocol: rule.protocol,
      rateLimit: rule.rateLimit ?? 0,
      burst: rule.burst ?? 0,
      stateful: rule.stateful,
      enabled: rule.enabled !== false,
      ports: rule.ports,
      sourcePorts: rule.sourcePorts,
      srcDevices,
      srcCidrs: [...srcCidrs].sort(),
      srcSubnets: [...srcSubnets.values()],
      dst,
      srcTags: [...srcTags].sort(),
      srcGroups: [...srcGroups].sort(),
      dstGroups: [...dstGroups].sort(),
      raw: rule,
    });
  });

  if (options.strict && issues.length > 0) {
    throw new SubjectResolutionError(issues);
  }

  // EasyTier group memberships per device: its tags plus the user groups its
  // owner belongs to. Both are namespaced (`tag:` / `group:`) and distinct.
  const groupsByDevice = new Map<string, string[]>();
  for (const device of approved) {
    const groups = new Set<string>(device.tags.map(tagGroupName));
    const user = device.ownerUserId ? usersById.get(device.ownerUserId) : undefined;
    if (user) {
      for (const group of userGroups) {
        if (matchUser(group, user)) groups.add(userGroupName(group.name));
      }
    }
    groupsByDevice.set(
      device.id,
      [...groups].filter((group) => group.startsWith("tag:") || group.startsWith("group:")).sort(),
    );
  }

  return {
    statements,
    warnings,
    referencedTags: [...referencedTags].sort(),
    groupsByDevice,
  };
}

/** Convenience for the UI: the source IP set of a resolved statement. */
export function sourceIpsOf(statement: ResolvedStatement): string[] {
  const ips = statement.srcDevices.map((device) => ipv4ToHostCidr(device.virtualIpv4));
  return [
    ...new Set([
      ...ips,
      ...statement.srcCidrs,
      ...statement.srcSubnets.map((subnet) => subnet.cidr),
    ]),
  ].sort();
}

/** Destination device IPs/CIDRs of a resolved statement (no subnet coverage). */
export function destinationIpsOf(
  statement: ResolvedStatement,
  options: { includeSelf?: (deviceId: string) => boolean } = {},
): string[] {
  const ips = new Set<string>();
  for (const entry of statement.dst) {
    if (entry.kind === "device") {
      if (options.includeSelf && !options.includeSelf(entry.device.id)) continue;
      ips.add(ipv4ToHostCidr(entry.device.virtualIpv4));
    } else {
      ips.add(entry.cidr);
    }
  }
  return [...ips].sort();
}

/**
 * IPv4 CIDRs are canonicalised with the existing helper; IPv6 passes through
 * (EasyTier accepts the standard textual form).
 */
export function normalizeCidrOrKeep(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes(":") || !trimmed.includes("/")) return trimmed;
  try {
    return normalizeCidr(trimmed);
  } catch {
    return trimmed;
  }
}
