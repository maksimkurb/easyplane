import { acl } from "@easyplane/proto";

/**
 * Canonical JSON for an ACL message.
 *
 * `GetNetworkInstanceConfig` returns the configuration the client stored, and
 * proto3 drops default values on the wire, so two equal ACLs can differ in
 * `undefined` vs `0`/`[]`. Comparing canonical forms keeps the drift check
 * semantic instead of byte-based.
 */
export interface CanonicalRule {
  [key: string]: unknown;
}

export function canonicalAcl(value: acl.Acl | undefined | null): string {
  if (!value || !value.aclV1) return "";
  const chains = (value.aclV1.chains ?? [])
    .map((chain) => ({
      name: chain.name ?? "",
      type: chain.chainType ?? 0,
      enabled: Boolean(chain.enabled),
      defaultAction: chain.defaultAction ?? 0,
      rules: (chain.rules ?? [])
        .map((rule) => ({
          name: rule.name ?? "",
          priority: rule.priority ?? 0,
          enabled: Boolean(rule.enabled),
          protocol: rule.protocol ?? 0,
          action: rule.action ?? 0,
          ports: [...(rule.ports ?? [])],
          sourceIps: [...(rule.sourceIps ?? [])],
          destinationIps: [...(rule.destinationIps ?? [])],
          sourcePorts: [...(rule.sourcePorts ?? [])],
          sourceGroups: [...(rule.sourceGroups ?? [])],
          destinationGroups: [...(rule.destinationGroups ?? [])],
          rateLimit: rule.rateLimit ?? 0,
          burstLimit: rule.burstLimit ?? 0,
          stateful: Boolean(rule.stateful),
        }))
        .sort((left, right) => right.priority - left.priority),
    }))
    .sort((left, right) => left.type - right.type);
  const group = value.aclV1.group;
  return JSON.stringify({
    chains,
    group: group
      ? {
          declares: [...(group.declares ?? [])]
            .map((entry) => ({
              name: entry.groupName ?? "",
              // Secrets are compared by presence only: they must match, but the
              // value never leaves the process.
              hasSecret: (entry.groupSecret ?? "") !== "",
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          members: [...(group.members ?? [])].sort(),
        }
      : null,
  });
}
