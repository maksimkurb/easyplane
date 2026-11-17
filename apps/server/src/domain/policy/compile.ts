import { acl } from "@easyplane/proto";

import {
  acceptedRoutesFor,
  approvedSubnetCidrs,
  cidrContains,
  ipv4ToHostCidr,
} from "../routes.js";
import type { PolicyChainConfig, PolicyDocument } from "./document.js";
import {
  destinationIpsOf,
  resolvePolicy,
  sourceIpsOf,
  type PolicyDevice,
  type PolicyRouteInput,
  type PolicyUser,
  type PolicySubnetInput,
  type PolicyUserGroupInput,
  type ResolvedStatement,
} from "./resolve.js";

/**
 * Tailscale-style policy -> EasyTier ACL compiler (v2).
 *
 * EasyTier evaluates three chains per instance
 * (easytier-core/src/peers/acl/{filter,processor}.rs):
 *
 * - `Inbound`: packet arriving at this node whose destination IP is local.
 * - `Outbound`: packet leaving this node.
 * - `Forward`: packet arriving at this node whose destination is not local,
 *   i.e. traffic through a subnet router (and the chain the userspace subnet
 *   proxy checks when it opens a connection into the proxied LAN).
 *
 * Matching is "highest priority first, first match wins" (`priority` is sorted
 * descending, `enabled` and every non-empty criterion must match).
 *
 * The translation is driven by what the pinned client was measured to do
 * (docs/POLICY.md §3, test/conformance/policy-spike.test.ts):
 *
 * - **One rule is compiled for every place the flow can be decided.** An
 *   `allow A -> B` becomes an Inbound allow on B, an Outbound allow on A when
 *   the outbound chain is not default-allow, and a Forward allow on a subnet
 *   router when the source or destination lives behind one.
 * - **Replies.** EasyTier has no established/related match. It lets a reply
 *   through its inbound path only when the *same* node previously sent a
 *   packet on the same 5-tuple and the outbound chain allowed it
 *   (`outbound_allow_records`, 30 s). With the default outbound `allow` that is
 *   enough; with a default-drop egress chain, or for a connection idle longer
 *   than the record's life, it is not. The compiler therefore emits explicit
 *   **reverse rules** (lower priority than every explicit rule) for the
 *   destination's egress and for the subnet router's forward path. That is what
 *   makes `allow A -> B tcp 443` work end to end without the user thinking
 *   about return traffic.
 * - **A chain's `enabled: false` is implemented by omitting the chain**, never
 *   by `Chain.enabled = false`: upstream still honours the chain's
 *   `default_action` when the chain object is present but disabled.
 * - **A missing chain means Allow** for that direction, so omitting an
 *   inbound chain disables inbound filtering entirely.
 * - The outbound chain is default-ALLOW by default and the forward chain
 *   default-BLOCK, matching the model's defaults.
 */

export const MAX_POLICY_STATEMENTS = 60_000;

/**
 * Priority bands. Explicit rules use document order in the high band; reverse
 * rules sit in a low band so an explicit `deny` always outranks a convenience
 * reply rule, no matter where it appears in the list. `priority` is a uint32.
 */
const EXPLICIT_PRIORITY_BASE = 65_535;
const REVERSE_PRIORITY_MAX = 1_000;

export interface CompileInput {
  document: PolicyDocument;
  devices: readonly PolicyDevice[];
  users: readonly PolicyUser[];
  knownTags: readonly string[];
  routes: readonly PolicyRouteInput[];
  subnets?: readonly PolicySubnetInput[];
  userGroups?: readonly PolicyUserGroupInput[];
}

export interface CompiledDeviceAcl {
  deviceId: string;
  acl: acl.Acl;
  warnings: string[];
}

export interface CompileResult {
  byDevice: Map<string, CompiledDeviceAcl>;
  warnings: string[];
  /** EasyTier group names whose secret this device's config declares. */
  declaredGroups: Map<string, string[]>;
  /** @deprecated v1 name for `declaredGroups`. */
  declaredTags: Map<string, string[]>;
}

const PROTOCOL = {
  any: acl.Protocol.Any,
  tcp: acl.Protocol.TCP,
  udp: acl.Protocol.UDP,
  icmp: acl.Protocol.ICMP,
  icmpv6: acl.Protocol.ICMPv6,
} as const;

const ACTION = {
  allow: acl.Action.Allow,
  deny: acl.Action.Drop,
} as const;

function ruleSuffix(entry: ResolvedStatement, suffix: string): string {
  return `${entry.name}-${suffix}`;
}

function describe(entry: ResolvedStatement, subjectName: string): string {
  return `${entry.action} ${entry.raw.from.join(", ")} -> ${subjectName} (${entry.raw.to.join(", ")})`;
}

function mergedPorts(ports: string[][]): string[] {
  if (ports.some((entry) => entry.length === 0)) return [];
  return [...new Set(ports.flat())];
}

interface RuleOptions {
  name: string;
  description: string;
  action: acl.Action;
  ports?: string[];
  sourceIps?: string[];
  destinationIps?: string[];
  sourcePorts?: string[];
  sourceGroups?: string[];
  destinationGroups?: string[];
  /** Reverse/convenience rule: lives in the low priority band. */
  reverse?: boolean;
}

function baseRule(entry: ResolvedStatement, options: RuleOptions): acl.Rule {
  const priority = options.reverse
    ? REVERSE_PRIORITY_MAX - (entry.index % REVERSE_PRIORITY_MAX)
    : EXPLICIT_PRIORITY_BASE - entry.index;
  return {
    name: options.name,
    description: options.description,
    priority,
    enabled: true,
    protocol: PROTOCOL[entry.protocol],
    ports: options.ports ?? [],
    sourceIps: options.sourceIps ?? [],
    destinationIps: options.destinationIps ?? [],
    sourcePorts: options.sourcePorts ?? [],
    action: options.action,
    rateLimit: entry.rateLimit,
    burstLimit: entry.burst,
    stateful: entry.stateful,
    sourceGroups: options.sourceGroups ?? [],
    destinationGroups: options.destinationGroups ?? [],
  };
}

function chainAction(config: PolicyChainConfig): acl.Action {
  return config.default === "allow" ? acl.Action.Allow : acl.Action.Drop;
}

/**
 * Compiles the policy document into one ACL per device.
 *
 * `groupSecret` derives the EasyTier group secret for a group name (`tag:x` or
 * `group:y`). It is a function so the compiler stays pure and golden-testable;
 * the service passes HMAC(master key, networkId, group) and secrets never touch
 * the database.
 */
export function compilePolicy(
  input: CompileInput,
  groupSecret: (group: string) => string,
): CompileResult {
  const resolved = resolvePolicy(input, { strict: false });
  const warnings = [...resolved.warnings];
  if (input.document.mode === "open") {
    // Open mode: no ACL is pushed at all. The document is still stored so
    // switching back to rules does not lose it.
    return {
      byDevice: new Map(),
      warnings,
      declaredGroups: new Map(),
      declaredTags: new Map(),
    };
  }
  const approved = input.devices.filter((device) => device.virtualIpv4 !== "");
  const deviceById = new Map(input.devices.map((device) => [device.id, device]));
  const chainsConfig = input.document.chains;
  const strictGroups = input.document.options.strictTags
    ? [...resolved.statements.flatMap((entry) => entry.srcTags)]
    : [];
  const strictUserGroups = input.document.options.strictGroups
    ? [...resolved.statements.flatMap((entry) => entry.srcGroups)]
    : [];
  const byDevice = new Map<string, CompiledDeviceAcl>();
  const declaredGroups = new Map<string, string[]>();
  const outboundDefaultBlock =
    chainsConfig.outbound.enabled && chainsConfig.outbound.default === "block";
  const forwardDefaultBlock =
    chainsConfig.forward.enabled && chainsConfig.forward.default === "block";

  /** Routers that serve an approved subnet covering `cidr`. */
  function routersFor(cidr: string): string[] {
    const routers = new Set<string>();
    for (const route of input.routes) {
      if (route.kind !== "subnet" || route.state !== "approved") continue;
      try {
        if (cidrContains(route.cidr, cidr)) routers.add(route.deviceId);
      } catch {
        // IPv6 or malformed; no router inference.
      }
    }
    return [...routers];
  }

  function groupCriteria(entry: ResolvedStatement): string[] {
    return [...new Set([...strictGroups, ...strictUserGroups])].filter((group) =>
      entry.srcTags.includes(group) || entry.srcGroups.includes(group),
    );
  }

  /**
   * Destination group criteria (EasyTier `destination_groups`) for a rule whose
   * destination is this device. The destination's own advertised groups are
   * what a peer sees, so only memberships this device really has are emitted.
   */
  function destinationCriteria(
    entry: ResolvedStatement,
    device: (typeof approved)[number],
  ): string[] {
    const memberships = resolved.groupsByDevice.get(device.id) ?? [];
    const wanted = new Set<string>();
    if (input.document.options.strictTags) {
      for (const group of entry.dstGroups) if (group.startsWith("tag:")) wanted.add(group);
    }
    if (input.document.options.strictGroups) {
      for (const group of entry.dstGroups) if (group.startsWith("group:")) wanted.add(group);
    }
    return [...wanted].filter((group) => memberships.includes(group)).sort();
  }

  for (const device of approved) {
    const ownRoutes = approvedSubnetCidrs(input.routes, device.id);
    const inboundRules: acl.Rule[] = [];
    const outboundRules: acl.Rule[] = [];
    const forwardRules: acl.Rule[] = [];
    // Group secrets this device must verify in addition to advertising its own
    // memberships. Populated while rules are emitted.
    const verifiedGroups = new Set<string>();

    for (const entry of resolved.statements) {
      if (!entry.enabled) continue;
      const sources = sourceIpsOf(entry);
      const criteria = groupCriteria(entry);
      const isAllow = entry.action === "allow";

      // (1) The destination device's Inbound chain: the primary receive-side
      // rule for both allow and deny.
      const destinationDevices = entry.dst.filter(
        (target) => target.kind === "device" && target.device.id === device.id,
      );
      if (destinationDevices.length > 0) {
        const ports = mergedPorts(
          destinationDevices.map((target) => (target.kind === "device" ? target.ports : [])),
        );
        const destinationsGroups = destinationCriteria(entry, device);
        if (sources.length > 0 || criteria.length > 0) {
          if (criteria.length > 0) for (const group of criteria) verifiedGroups.add(group);
          inboundRules.push(
            baseRule(entry, {
              name: ruleSuffix(entry, "in"),
              description: describe(entry, `${device.hostname} (inbound)`),
              action: ACTION[entry.action],
              ports,
              sourcePorts: entry.sourcePorts,
              sourceIps: sources,
              sourceGroups: criteria,
              destinationGroups: destinationsGroups,
            }),
          );
        }
      }

      // (2) The source device's Outbound chain: egress is only restricted when
      // its default is block (or an earlier explicit deny matches). Emitting
      // the allow also creates the outbound record the reply path relies on.
      const sourceDevices = entry.srcDevices;
      const needsEgressRule = isAllow ? outboundDefaultBlock : true;
      if (sourceDevices.some((source) => source.id === device.id) && needsEgressRule) {
        const destinationIps = destinationIpsOf(entry, {
          includeSelf: (id) => id !== device.id,
        });
        if (destinationIps.length > 0) {
          outboundRules.push(
            baseRule(entry, {
              name: ruleSuffix(entry, isAllow ? "out" : "deny-out"),
              description: describe(entry, "egress"),
              action: ACTION[entry.action],
              ports: mergedPorts(entry.dst.map((target) => target.ports)),
              sourcePorts: entry.sourcePorts,
              destinationIps,
            }),
          );
        }
      }

      // (3) A source subnet: the LAN host's packets leave the router through
      // its Outbound chain, so an allow/deny is needed there when egress is
      // filtered.
      for (const subnet of entry.srcSubnets) {
        const routerId =
          subnet.viaDeviceId ??
          routersFor(subnet.cidr).find((candidate) => candidate === device.id) ??
          null;
        if (routerId !== device.id) continue;
        if (isAllow && !outboundDefaultBlock) continue;
        const destinationIps = destinationIpsOf(entry);
        if (destinationIps.length === 0) continue;
        outboundRules.push(
          baseRule(entry, {
            name: ruleSuffix(entry, isAllow ? "lan-out" : "lan-deny-out"),
            description: describe(entry, `${subnet.alias} egress`),
            action: ACTION[entry.action],
            ports: mergedPorts(entry.dst.map((target) => target.ports)),
            sourcePorts: entry.sourcePorts,
            // The router's userspace subnet proxy may present its own overlay
            // address as the source for traffic it terminates on behalf of the
            // LAN (measured: the egress chain sees the router's IP). Admit it
            // alongside the LAN range so a default-drop egress works.
            sourceIps: [subnet.cidr, ipv4ToHostCidr(device.virtualIpv4)],
            destinationIps,
          }),
        );
      }

      // (4) A destination subnet (or a CIDR covered by an approved route): the
      // router's Forward chain decides the connection.
      for (const target of entry.dst) {
        const cidr = target.kind === "cidr" || target.kind === "subnet" ? target.cidr : null;
        if (!cidr) continue;
        const routers =
          target.kind === "subnet" && target.viaDeviceId
            ? [target.viaDeviceId]
            : routersFor(cidr);
        if (!routers.includes(device.id)) continue;
        // Forward default allow means the router already passes an allow;
        // only an explicit deny still needs a rule there.
        if (isAllow && !forwardDefaultBlock) continue;
        if (sources.length === 0 && criteria.length === 0) continue;
        if (criteria.length > 0) for (const group of criteria) verifiedGroups.add(group);
        forwardRules.push(
          baseRule(entry, {
            name: ruleSuffix(entry, target.kind === "subnet" ? "subnet-fwd" : "fwd"),
            description: describe(entry, `${device.hostname} subnet forward`),
            action: ACTION[entry.action],
            ports: target.ports,
            sourcePorts: entry.sourcePorts,
            sourceIps: sources,
            sourceGroups: criteria,
            destinationIps: [cidr],
          }),
        );
      }

      // Reverse rules (allow only): replies of the flow, at the place they are
      // decided. Lower priority than every explicit rule.
      if (isAllow) {
        // The destination device's egress (replies).
        if (outboundDefaultBlock && destinationDevices.length > 0) {
          const dstIsSource = sourceDevices.some((source) => source.id === device.id);
          if (!dstIsSource && sources.length > 0) {
            const ports = mergedPorts(
              destinationDevices.map((target) =>
                target.kind === "device" ? target.ports : [],
              ),
            );
            outboundRules.push(
              baseRule(entry, {
                name: ruleSuffix(entry, "reply-out"),
                description: `replies for ${entry.name} (egress)`,
                action: acl.Action.Allow,
                destinationIps: sources,
                sourcePorts: entry.protocol === "tcp" || entry.protocol === "udp" ? ports : [],
                reverse: true,
              }),
            );
          }
        }
        // A source subnet's replies arrive at its router on Forward.
        for (const subnet of entry.srcSubnets) {
          const routerId =
            subnet.viaDeviceId ??
            routersFor(subnet.cidr).find((candidate) => candidate === device.id) ??
            null;
          if (routerId !== device.id || !forwardDefaultBlock) continue;
          const destinationIps = destinationIpsOf(entry);
          if (destinationIps.length === 0) continue;
          forwardRules.push(
            baseRule(entry, {
              name: ruleSuffix(entry, "reply-fwd"),
              description: `replies for ${entry.name} into ${subnet.alias}`,
              action: acl.Action.Allow,
              sourceIps: destinationIps,
              destinationIps: [subnet.cidr],
              sourcePorts:
                entry.protocol === "tcp" || entry.protocol === "udp"
                  ? mergedPorts(entry.dst.map((target) => target.ports))
                  : [],
              reverse: true,
            }),
          );
        }
        // A destination subnet's replies leave its router through Outbound.
        for (const target of entry.dst) {
          const cidr = target.kind === "cidr" || target.kind === "subnet" ? target.cidr : null;
          if (!cidr) continue;
          const routers =
            target.kind === "subnet" && target.viaDeviceId
              ? [target.viaDeviceId]
              : routersFor(cidr);
          if (!routers.includes(device.id) || !outboundDefaultBlock) continue;
          if (sources.length === 0) continue;
          outboundRules.push(
            baseRule(entry, {
              name: ruleSuffix(entry, "reply-lan-out"),
              description: `replies for ${entry.name} from the subnet`,
              action: acl.Action.Allow,
              sourceIps: [cidr, ipv4ToHostCidr(device.virtualIpv4)],
              destinationIps: sources,
              sourcePorts:
                entry.protocol === "tcp" || entry.protocol === "udp" ? target.ports : [],
              reverse: true,
            }),
          );
          // EasyTier's subnet proxy terminates the connection and sends the
          // return traffic itself, addressed from the router's overlay IP to
          // the original client with the proxy's own ephemeral source port.
          // There is no port criterion to match, only the peer pair.
          outboundRules.push(
            baseRule(entry, {
              name: ruleSuffix(entry, "proxy-out"),
              description: `subnet proxy replies for ${entry.name}`,
              action: acl.Action.Allow,
              sourceIps: [ipv4ToHostCidr(device.virtualIpv4)],
              destinationIps: sources,
              reverse: true,
            }),
          );
        }
      }
    }

    const aclChains: acl.Chain[] = [];
    if (chainsConfig.inbound.enabled) {
      aclChains.push({
        name: chainsConfig.inbound.name ?? "easyplane-inbound",
        chainType: acl.ChainType.Inbound,
        description: "Destination-side policy enforcement",
        enabled: true,
        rules: inboundRules,
        defaultAction: chainAction(chainsConfig.inbound),
      });
    }
    if (chainsConfig.outbound.enabled) {
      aclChains.push({
        name: chainsConfig.outbound.name ?? "easyplane-outbound",
        chainType: acl.ChainType.Outbound,
        description: "Source-side policy enforcement and reply records",
        enabled: true,
        rules: outboundRules,
        defaultAction: chainAction(chainsConfig.outbound),
      });
    }
    const needsForward = ownRoutes.length > 0 || forwardRules.length > 0;
    if (chainsConfig.forward.enabled && needsForward) {
      aclChains.push({
        name: chainsConfig.forward.name ?? "easyplane-forward",
        chainType: acl.ChainType.Forward,
        description: "Subnet-router forwarding",
        enabled: true,
        rules: forwardRules,
        defaultAction: chainAction(chainsConfig.forward),
      });
    }

    // Group declarations: this device advertises its own memberships (tags and
    // user groups of its owner) and holds the secrets it must verify.
    const memberships = resolved.groupsByDevice.get(device.id) ?? [];
    const declared = new Set<string>(memberships);
    for (const group of verifiedGroups) declared.add(group);
    const declaredList = [...declared].sort();
    declaredGroups.set(device.id, declaredList);
    const group: acl.GroupInfo = {
      declares: declaredList.map((name) => ({
        groupName: name,
        groupSecret: groupSecret(name),
      })),
      members: memberships,
    };

    byDevice.set(device.id, {
      deviceId: device.id,
      acl: { aclV1: { chains: aclChains, group } },
      warnings: [],
    });
  }

  if (warnings.length > 0) {
    for (const entry of byDevice.values()) entry.warnings = [...warnings];
  }
  return { byDevice, warnings, declaredGroups, declaredTags: declaredGroups };
}

/**
 * "Accept routes" list for a device: approved subnet routes of other devices
 * when the device asked to accept routes.
 */
export function manualRoutesFor(
  routes: readonly PolicyRouteInput[],
  deviceId: string,
  acceptRoutes: boolean,
): string[] {
  return acceptRoutes ? acceptedRoutesFor(routes, deviceId) : [];
}

// Keep the helper exported for callers that used the v1 convention.
export { ipv4ToHostCidr };
