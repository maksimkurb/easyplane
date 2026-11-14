import { acl } from "@easyplane/proto";

import {
  acceptedRoutesFor,
  approvedSubnetCidrs,
  cidrContains,
  ipv4ToHostCidr,
} from "../routes.js";
import type { PolicyDocument } from "./document.js";
import {
  resolvePolicy,
  sourceIpsOf,
  type PolicyDevice,
  type PolicyRouteInput,
  type PolicyUser,
  type ResolvedStatement,
} from "./resolve.js";

/**
 * Tailscale-style policy -> EasyTier ACL compiler.
 *
 * EasyTier evaluates three chains per instance
 * (easytier-core/src/peers/acl/{filter,processor}.rs):
 *
 * - `Inbound`: packet arriving at this node whose destination IP is local.
 * - `Outbound`: packet leaving this node.
 * - `Forward`: packet arriving at this node whose destination is not local,
 *   i.e. traffic through a subnet router.
 *
 * Matching is "highest priority first, first match wins" (`priority` is sorted
 * descending, `enabled` and every non-empty criterion must match). That maps
 * directly onto an ordered policy document.
 *
 * Deliberate choices (docs/POLICY.md explains each one):
 *
 * - The inbound chain is default-DROP: the destination enforces the policy,
 *   like Tailscale.
 * - The outbound chain is default-ALLOW and only carries explicit `deny`
 *   statements. EasyTier has no connection tracking for the outbound direction
 *   (`stateful` only records the flow), so a default-DROP egress chain would
 *   also drop a server's responses to an allowed inbound request.
 * - The forward chain is default-DROP on subnet routers: forwarding to a
 *   proxied CIDR requires an explicit policy statement.
 * - Rules match on source/destination IPs enumerated at compile time. With
 *   `options.strictTags` a second criterion (`source_groups`) is added for
 *   tag sources so EasyTier verifies the sender's group proof as well.
 */

export const MAX_POLICY_STATEMENTS = 60_000;

export interface CompileInput {
  document: PolicyDocument;
  devices: readonly PolicyDevice[];
  users: readonly PolicyUser[];
  knownTags: readonly string[];
  routes: readonly PolicyRouteInput[];
}

export interface CompiledDeviceAcl {
  deviceId: string;
  acl: acl.Acl;
  warnings: string[];
}

export interface CompileResult {
  byDevice: Map<string, CompiledDeviceAcl>;
  warnings: string[];
  /** Tag names whose group secret this device's config declares. */
  declaredTags: Map<string, string[]>;
}

const PROTOCOL = {
  any: acl.Protocol.Any,
  tcp: acl.Protocol.TCP,
  udp: acl.Protocol.UDP,
  icmp: acl.Protocol.ICMP,
} as const;

const ACTION = {
  accept: acl.Action.Allow,
  deny: acl.Action.Drop,
} as const;

function ruleName(statement: ResolvedStatement, suffix: string): string {
  return `${statement.name}-${suffix}`;
}

function describe(statement: ResolvedStatement, subjectName: string): string {
  const ports = statement.raw.dst.join(", ");
  return `${statement.action} ${statement.raw.src.join(", ")} -> ${subjectName} (${ports})`;
}

function mergedPorts(ports: string[][]): string[] {
  if (ports.some((entry) => entry.length === 0)) return [];
  return [...new Set(ports.flat())];
}

function baseRule(
  statement: ResolvedStatement,
  options: {
    name: string;
    description: string;
    action: acl.Action;
    ports: string[];
    sourceIps: string[];
    destinationIps: string[];
    sourceGroups?: string[];
  },
): acl.Rule {
  return {
    name: options.name,
    description: options.description,
    priority: 65_535 - statement.index,
    enabled: true,
    protocol: PROTOCOL[statement.protocol],
    ports: options.ports,
    sourceIps: options.sourceIps,
    destinationIps: options.destinationIps,
    sourcePorts: [],
    action: options.action,
    rateLimit: statement.rateLimit,
    burstLimit: statement.burst,
    stateful: statement.stateful,
    sourceGroups: options.sourceGroups ?? [],
    destinationGroups: [],
  };
}

/**
 * Compiles the policy document into one ACL per device.
 *
 * `groupSecret` derives the EasyTier group secret for a tag. It is a function
 * so the compiler stays pure and golden-testable; the service passes
 * HMAC(master key, networkId, tag) and secrets never touch the database.
 */
export function compilePolicy(
  input: CompileInput,
  groupSecret: (tag: string) => string,
): CompileResult {
  const resolved = resolvePolicy(input, { strict: false });
  const warnings = [...resolved.warnings];
  const approved = input.devices.filter((device) => device.virtualIpv4 !== "");
  const strictTags = input.document.options.strictTags;
  const byDevice = new Map<string, CompiledDeviceAcl>();
  const declaredTags = new Map<string, string[]>();

  for (const device of approved) {
    const inboundRules: acl.Rule[] = [];
    const outboundRules: acl.Rule[] = [];
    const forwardRules: acl.Rule[] = [];

    const ownRoutes = approvedSubnetCidrs(input.routes, device.id);

    for (const statement of resolved.statements) {
      const sources = sourceIpsOf(statement);

      // (1) Inbound: this device is an explicit destination. Only accepts are
      // emitted: the chain already defaults to Drop, so a deny rule would be
      // redundant (and would shadow nothing).
      const destinations = statement.dst.filter(
        (entry) => entry.kind === "device" && entry.device.id === device.id,
      );
      if (statement.action === "accept" && destinations.length > 0) {
        const ports = mergedPorts(
          destinations.map((entry) => (entry.kind === "device" ? entry.ports : [])),
        );
        if (sources.length > 0) {
          const groups = strictTags ? statement.srcTags : [];
          inboundRules.push(
            baseRule(statement, {
              name: ruleName(statement, "in"),
              description: describe(statement, `${device.hostname} (inbound)`),
              action: ACTION[statement.action],
              ports,
              sourceIps: sources,
              destinationIps: [],
              sourceGroups: groups,
            }),
          );
        }
      }

      // (2) Outbound: only explicit deny statements restrict egress.
      if (statement.action === "deny" && statement.srcDevices.some((entry) => entry.id === device.id)) {
        const destinationIps = new Set<string>();
        for (const entry of statement.dst) {
          if (entry.kind === "device" && entry.device.id !== device.id) {
            destinationIps.add(ipv4ToHostCidr(entry.device.virtualIpv4));
          } else if (entry.kind === "cidr") {
            destinationIps.add(entry.cidr);
          }
        }
        if (destinationIps.size > 0) {
          outboundRules.push(
            baseRule(statement, {
              name: ruleName(statement, "out"),
              description: describe(statement, "egress denied"),
              action: acl.Action.Drop,
              ports: mergedPorts(
                statement.dst.map((entry) => entry.ports),
              ),
              sourceIps: [],
              destinationIps: [...destinationIps].sort(),
            }),
          );
        }
      }

      // (3) Forward: this device is a subnet router for a CIDR in the policy.
      // The forward chain defaults to Drop, so only accepts are emitted.
      if (statement.action === "accept" && ownRoutes.length > 0) {
        const forwardTargets = statement.dst.filter(
          (entry) =>
            entry.kind === "cidr" &&
            ownRoutes.some((route) => cidrContains(route, entry.cidr)),
        );
        if (forwardTargets.length > 0 && sources.length > 0) {
          forwardRules.push(
            baseRule(statement, {
              name: ruleName(statement, "fwd"),
              description: describe(statement, `${device.hostname} subnet forward`),
              action: ACTION[statement.action],
              ports: mergedPorts(
                forwardTargets.map((entry) => (entry.kind === "cidr" ? entry.ports : [])),
              ),
              sourceIps: sources,
              destinationIps: [
                ...new Set(
                  forwardTargets.flatMap((entry) => (entry.kind === "cidr" ? [entry.cidr] : [])),
                ),
              ].sort(),
            }),
          );
        }
      }
    }

    const chains: acl.Chain[] = [
      {
        name: "easyplane-inbound",
        chainType: acl.ChainType.Inbound,
        description: "Destination-side policy enforcement (default drop)",
        enabled: true,
        rules: inboundRules,
        defaultAction: acl.Action.Drop,
      },
      {
        name: "easyplane-outbound",
        chainType: acl.ChainType.Outbound,
        description: "Explicit egress denies only (default allow)",
        enabled: true,
        rules: outboundRules,
        defaultAction: acl.Action.Allow,
      },
    ];
    if (ownRoutes.length > 0) {
      chains.push({
        name: "easyplane-forward",
        chainType: acl.ChainType.Forward,
        description: "Subnet-router forwarding (default drop)",
        enabled: true,
        rules: forwardRules,
        defaultAction: acl.Action.Drop,
      });
    }

    // Group declarations: this device proves membership in its own tags and,
    // in strict mode, declares the tag secrets it must verify.
    const tags = new Set(device.tags);
    if (strictTags) {
      for (const statement of resolved.statements) {
        const appliesHere = statement.dst.some(
          (entry) =>
            (entry.kind === "device" && entry.device.id === device.id) ||
            (entry.kind === "cidr" &&
              ownRoutes.some((route) => cidrContains(route, entry.cidr))),
        );
        if (appliesHere) {
          for (const tag of statement.srcTags) tags.add(tag);
        }
      }
    }
    const declared = [...tags].filter((tag) => tag.startsWith("tag:")).sort();
    declaredTags.set(device.id, declared);
    const group: acl.GroupInfo = {
      declares: declared.map((tag) => ({
        groupName: tag,
        groupSecret: groupSecret(tag),
      })),
      members: declared.filter((tag) => device.tags.includes(tag)),
    };

    byDevice.set(device.id, {
      deviceId: device.id,
      acl: { aclV1: { chains, group } },
      warnings: [],
    });
  }

  if (warnings.length > 0) {
    for (const entry of byDevice.values()) entry.warnings = [...warnings];
  }
  return { byDevice, warnings, declaredTags };
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
