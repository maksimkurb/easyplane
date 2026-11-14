import { ipv4ToHostCidr, normalizeCidr } from "../routes.js";
import {
  splitDestination,
  subjectKind,
  type PolicyDocument,
  type PolicyStatement,
} from "./document.js";

/**
 * Expansion of policy subjects into concrete devices and CIDRs.
 *
 * Resolution is strict when a policy is saved or previewed (unknown names are
 * errors) and lenient when a config is compiled for an online device (a device
 * or tag can disappear between two pushes; that must not wedge the network).
 */

export interface PolicyDevice {
  id: string;
  /** Unique DNS label inside the network. */
  hostname: string;
  virtualIpv4: string;
  ownerUserId: string | null;
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

export interface ResolveInput {
  document: PolicyDocument;
  devices: readonly PolicyDevice[];
  users: readonly PolicyUser[];
  knownTags: readonly string[];
  routes: readonly PolicyRouteInput[];
}

export type ResolvedDst =
  | { kind: "device"; device: PolicyDevice; ports: string[] }
  | { kind: "cidr"; cidr: string; ports: string[] };

export interface ResolvedStatement {
  index: number;
  name: string;
  action: "accept" | "deny";
  protocol: "any" | "tcp" | "udp" | "icmp";
  rateLimit: number;
  burst: number;
  stateful: boolean;
  srcDevices: PolicyDevice[];
  /** `cidr:` sources, useful for subnet-router forwarding rules. */
  srcCidrs: string[];
  dst: ResolvedDst[];
  /** Tag subjects appearing in `src`, used for strict group matching. */
  srcTags: string[];
  raw: PolicyStatement;
}

export interface ResolveResult {
  statements: ResolvedStatement[];
  warnings: string[];
  /** Tags referenced by the document (validated against `knownTags`). */
  referencedTags: string[];
}

export class SubjectResolutionError extends Error {
  constructor(readonly issues: string[]) {
    super("policy references unknown tags, groups or devices");
    this.name = "SubjectResolutionError";
  }
}

function matchUser(
  document: PolicyDocument,
  groupName: string,
  user: PolicyUser,
): boolean {
  const members = document.groups[groupName] ?? [];
  return members.some((member) => {
    const value = member.trim().toLowerCase();
    if (value.includes("@")) return value === user.email.toLowerCase();
    return user.groups.some((group) => group.toLowerCase() === value);
  });
}

export function resolvePolicy(
  input: ResolveInput,
  options: { strict: boolean },
): ResolveResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const knownTags = new Set(input.knownTags);
  const approved = input.devices.filter((device) => device.virtualIpv4 !== "");
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const document = input.document;

  const knownGroups = new Set(Object.keys(document.groups));

  function devicesForGroup(groupName: string): PolicyDevice[] {
    if (!knownGroups.has(groupName)) {
      if (options.strict) issues.push(`unknown group "${groupName}"`);
      else warnings.push(`unknown group "${groupName}"`);
      return [];
    }
    return approved.filter((device) => {
      if (!device.ownerUserId) return false;
      const user = usersById.get(device.ownerUserId);
      if (!user) return false;
      return matchUser(document, groupName, user);
    });
  }

  function resolveSrcSubject(
    subject: string,
    label: string,
  ): { devices: PolicyDevice[]; cidrs: string[]; tags: string[] } {
    const kind = subjectKind(subject);
    switch (kind) {
      case "all":
        return { devices: approved, cidrs: [], tags: [] };
      case "tag": {
        if (!knownTags.has(subject)) {
          if (options.strict) issues.push(`${label}: tag "${subject}" does not exist`);
          else warnings.push(`tag "${subject}" does not exist`);
          return { devices: [], cidrs: [], tags: [] };
        }
        const devices = approved.filter((device) => device.tags.includes(subject));
        return { devices, cidrs: [], tags: [subject] };
      }
      case "group":
        return { devices: devicesForGroup(subject), cidrs: [], tags: [] };
      case "device": {
        const name = subject.startsWith("device:")
          ? subject.slice("device:".length)
          : subject;
        const device = approved.find(
          (entry) => entry.hostname.toLowerCase() === name.toLowerCase(),
        );
        if (!device) {
          if (options.strict) {
            issues.push(`${label}: device "${name}" is not an approved device`);
          } else {
            warnings.push(`device "${name}" is not approved`);
          }
          return { devices: [], cidrs: [], tags: [] };
        }
        return { devices: [device], cidrs: [], tags: [] };
      }
      case "host": {
        const alias = subject.slice("host:".length);
        const value = document.hosts[alias];
        if (!value) {
          if (options.strict) issues.push(`${label}: host alias "${alias}" is undefined`);
          return { devices: [], cidrs: [], tags: [] };
        }
        try {
          return { devices: [], cidrs: [normalizeCidr(value)], tags: [] };
        } catch {
          issues.push(`${label}: host alias "${alias}" is not a valid CIDR`);
          return { devices: [], cidrs: [], tags: [] };
        }
      }
      case "cidr": {
        try {
          return {
            devices: [],
            cidrs: [normalizeCidr(subject.slice("cidr:".length))],
            tags: [],
          };
        } catch (error) {
          issues.push(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return { devices: [], cidrs: [], tags: [] };
        }
      }
      default:
        issues.push(`${label}: unknown subject "${subject}"`);
        return { devices: [], cidrs: [], tags: [] };
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
        if (!knownTags.has(subject)) {
          if (options.strict) issues.push(`${label}: tag "${subject}" does not exist`);
          else warnings.push(`tag "${subject}" does not exist`);
          return [];
        }
        return approved
          .filter((device) => device.tags.includes(subject))
          .map((device) => ({ kind: "device" as const, device, ports }));
      }
      case "group":
        return devicesForGroup(subject).map((device) => ({
          kind: "device" as const,
          device,
          ports,
        }));
      case "device": {
        const name = subject.startsWith("device:")
          ? subject.slice("device:".length)
          : subject;
        const device = approved.find(
          (entry) => entry.hostname.toLowerCase() === name.toLowerCase(),
        );
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
        try {
          return [{ kind: "cidr", cidr: normalizeCidr(value), ports }];
        } catch {
          issues.push(`${label}: host alias "${alias}" is not a valid CIDR`);
          return [];
        }
      }
      case "cidr": {
        try {
          return [
            { kind: "cidr", cidr: normalizeCidr(subject.slice("cidr:".length)), ports },
          ];
        } catch (error) {
          issues.push(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      }
      default:
        issues.push(`${label}: unknown destination "${subject}"`);
        return [];
    }
  }

  const statements: ResolvedStatement[] = [];
  const referencedTags = new Set<string>();

  document.acls.forEach((statement, index) => {
    const label = statement.name ?? `acls[${index}]`;
    let srcDevices: PolicyDevice[] = [];
    const srcCidrs = new Set<string>();
    const srcTags = new Set<string>();
    for (const subject of statement.src) {
      const resolved = resolveSrcSubject(subject, label);
      srcDevices = srcDevices.concat(resolved.devices);
      for (const cidr of resolved.cidrs) srcCidrs.add(cidr);
      for (const tag of resolved.tags) {
        srcTags.add(tag);
        referencedTags.add(tag);
      }
    }
    // Stable de-duplication by device id.
    const seen = new Set<string>();
    srcDevices = srcDevices.filter((device) => {
      if (seen.has(device.id)) return false;
      seen.add(device.id);
      return true;
    });

    const dst: ResolvedDst[] = [];
    for (const entry of statement.dst) {
      const { subject, ports } = splitDestination(entry);
      const parsedPorts =
        ports === "*"
          ? []
          : ports.split(",").map((port) => port.trim()).filter(Boolean);
      if (subjectKind(subject) === "tag") referencedTags.add(subject);
      dst.push(...resolveDstSubject(subject, parsedPorts, label));
    }

    if (srcDevices.length === 0 && srcCidrs.size === 0) {
      warnings.push(`${label}: no source devices match`);
    }
    if (dst.length === 0) warnings.push(`${label}: no destination devices match`);

    statements.push({
      index,
      name: statement.name ?? `stmt-${index + 1}`,
      action: statement.action,
      protocol: statement.proto,
      rateLimit: statement.rateLimit ?? 0,
      burst: statement.burst ?? 0,
      stateful: statement.stateful ?? false,
      srcDevices,
      srcCidrs: [...srcCidrs].sort(),
      dst,
      srcTags: [...srcTags].sort(),
      raw: statement,
    });
  });

  if (options.strict && issues.length > 0) {
    throw new SubjectResolutionError(issues);
  }
  return { statements, warnings, referencedTags: [...referencedTags].sort() };
}

/** Convenience for the UI: the source IP set of a resolved statement. */
export function sourceIpsOf(statement: ResolvedStatement): string[] {
  const ips = statement.srcDevices.map((device) => ipv4ToHostCidr(device.virtualIpv4));
  return [...new Set([...ips, ...statement.srcCidrs])].sort();
}
