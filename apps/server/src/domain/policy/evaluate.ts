import { acl } from "@easyplane/proto";

import { cidrContains } from "../routes.js";
import { ipv4ToHostCidr } from "../routes.js";

/**
 * Reachability evaluator.
 *
 * This mirrors the matcher in easytier-core/src/peers/acl/processor.rs:
 * rules are sorted by descending priority (stable, so document order breaks
 * ties), the first enabled rule whose non-empty criteria all match wins, and
 * otherwise the chain's default action applies. Port criteria are only checked
 * when the packet carries a port, exactly like upstream (an ICMP packet
 * therefore matches a rule with a port list).
 */

export interface PacketQuery {
  srcIp: string;
  dstIp: string;
  protocol: "tcp" | "udp" | "icmp" | "icmpv6";
  dstPort?: number;
  srcPort?: number;
  /** Tag names of the sender, used when a rule has group criteria. */
  srcGroups?: string[];
  /** Tag names of the receiver. */
  dstGroups?: string[];
}

export interface AclDecision {
  action: "allow" | "drop";
  chain: "Inbound" | "Outbound" | "Forward";
  matchedRule: string | null;
  priority: number | null;
  /** True when no rule matched and the chain default decided. */
  byDefault: boolean;
}

const PROTOCOL_NUMBER = {
  tcp: acl.Protocol.TCP,
  udp: acl.Protocol.UDP,
  icmp: acl.Protocol.ICMP,
  icmpv6: acl.Protocol.ICMPv6,
} as const;

function ipMatches(ranges: readonly string[], ip: string): boolean {
  const host = ipv4ToHostCidr(ip);
  return ranges.some((range) => {
    try {
      return cidrContains(range, host);
    } catch {
      return false;
    }
  });
}

function portInRanges(port: number, ranges: readonly string[]): boolean {
  return ranges.some((range) => {
    const [startPart, endPart] = range.split("-");
    const start = Number(startPart);
    const end = endPart === undefined ? start : Number(endPart);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
    return port >= start && port <= end;
  });
}

export function evaluateChain(
  value: acl.Acl,
  chainType: "Inbound" | "Outbound" | "Forward",
  packet: PacketQuery,
): AclDecision {
  const wanted = acl.ChainType[chainType];
  const chains = value.aclV1?.chains ?? [];
  const chain = chains.find((entry) => entry.chainType === wanted);
  if (!chain) {
    // Upstream defaults to Allow when a chain type is not configured.
    return {
      action: "allow",
      chain: chainType,
      matchedRule: null,
      priority: null,
      byDefault: true,
    };
  }
  const rules = [...(chain.rules ?? [])]
    .filter((rule) => rule.enabled !== false)
    .sort((left, right) => right.priority - left.priority);

  for (const rule of rules) {
    if (rule.protocol !== acl.Protocol.Any && rule.protocol !== PROTOCOL_NUMBER[packet.protocol]) {
      continue;
    }
    if (rule.sourceIps.length > 0 && !ipMatches(rule.sourceIps, packet.srcIp)) continue;
    if (rule.destinationIps.length > 0 && !ipMatches(rule.destinationIps, packet.dstIp)) {
      continue;
    }
    if (rule.sourcePorts.length > 0 && packet.srcPort !== undefined) {
      if (!portInRanges(packet.srcPort, rule.sourcePorts)) continue;
    }
    if (rule.ports.length > 0 && packet.dstPort !== undefined) {
      if (!portInRanges(packet.dstPort, rule.ports)) continue;
    }
    if (rule.sourceGroups.length > 0) {
      const groups = packet.srcGroups ?? [];
      if (!groups.some((group) => rule.sourceGroups.includes(group))) continue;
    }
    if (rule.destinationGroups.length > 0) {
      const groups = packet.dstGroups ?? [];
      if (!groups.some((group) => rule.destinationGroups.includes(group))) continue;
    }
    return {
      action: rule.action === acl.Action.Drop ? "drop" : "allow",
      chain: chainType,
      matchedRule: rule.name || `priority-${rule.priority}`,
      priority: rule.priority,
      byDefault: false,
    };
  }

  return {
    action: chain.defaultAction === acl.Action.Drop ? "drop" : "allow",
    chain: chainType,
    matchedRule: null,
    priority: null,
    byDefault: true,
  };
}

export interface ReachabilityResult {
  allowed: boolean;
  egress: AclDecision;
  ingress: AclDecision;
  /** Human-readable explanation lines for the UI. */
  explanation: string[];
}

export function evaluateReachability(input: {
  srcAcl: acl.Acl;
  dstAcl: acl.Acl;
  srcIp: string;
  dstIp: string;
  protocol: "tcp" | "udp" | "icmp" | "icmpv6";
  port?: number;
  srcTags?: string[];
  dstTags?: string[];
}): ReachabilityResult {
  const packet: PacketQuery = {
    srcIp: input.srcIp,
    dstIp: input.dstIp,
    protocol: input.protocol,
    ...(input.port !== undefined ? { dstPort: input.port } : {}),
    ...(input.srcTags ? { srcGroups: input.srcTags } : {}),
    ...(input.dstTags ? { dstGroups: input.dstTags } : {}),
  };
  const egress = evaluateChain(input.srcAcl, "Outbound", packet);
  const ingress = evaluateChain(input.dstAcl, "Inbound", packet);
  const allowed = egress.action === "allow" && ingress.action === "allow";
  const explanation = [
    `source outbound: ${egress.action}${egress.matchedRule ? ` (rule ${egress.matchedRule})` : " (default action)"}`,
    `destination inbound: ${ingress.action}${ingress.matchedRule ? ` (rule ${ingress.matchedRule})` : " (default action)"}`,
  ];
  if (!allowed) {
    explanation.push(
      egress.action === "drop"
        ? "an explicit deny rule on the source matches this flow"
        : "the destination policy does not allow this flow",
    );
  }
  return { allowed, egress, ingress, explanation };
}

/** Reachability of a CIDR behind a subnet router (forward chain). */
export function evaluateCidrReachability(input: {
  srcAcl: acl.Acl;
  routerAcl: acl.Acl;
  srcIp: string;
  cidr: string;
  protocol: "tcp" | "udp" | "icmp" | "icmpv6";
  port?: number;
  srcTags?: string[];
}): ReachabilityResult {
  const packet: PacketQuery = {
    srcIp: input.srcIp,
    dstIp: input.cidr.split("/")[0]!,
    protocol: input.protocol,
    ...(input.port !== undefined ? { dstPort: input.port } : {}),
    ...(input.srcTags ? { srcGroups: input.srcTags } : {}),
  };
  const egress = evaluateChain(input.srcAcl, "Outbound", packet);
  const ingress = evaluateChain(input.routerAcl, "Forward", packet);
  const allowed = egress.action === "allow" && ingress.action === "allow";
  return {
    allowed,
    egress,
    ingress,
    explanation: [
      `source outbound: ${egress.action}`,
      `subnet router forward: ${ingress.action}${ingress.matchedRule ? ` (rule ${ingress.matchedRule})` : " (default action)"}`,
    ],
  };
}
