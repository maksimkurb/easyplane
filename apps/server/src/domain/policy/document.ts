import { isIP } from "node:net";

import { z } from "zod";

import { parseHuJson } from "./hujson.js";

/**
 * EasyPlane policy document, version 2.
 *
 * Version 1 (M2) was Tailscale-shaped: `acls` with `src`/`dst` subjects whose
 * destination carried a `:port` suffix, a `groups` map of email lists, and
 * chain defaults that were not configurable. Version 2 keeps every v1 document
 * loadable (see `upgradePolicyDocument`) and changes the shape to the one the
 * Access editor works with:
 *
 * ```jsonc
 * {
 *   "version": 2,
 *   "mode": "rules",                       // open | rules | json
 *   "subnets": { "home-lan": { "cidr": "192.168.55.0/24", "via": "router-01" } },
 *   "tags": { "us": ["laptop-maxim"], "home": ["router-01", "nas-01"] },
 *   "userGroups": {
 *     "admins": { "source": "manual", "members": ["maxim@home.example"] },
 *     "family": { "source": "oidc", "members": ["anna@home.example"] }
 *   },
 *   "hosts": { "nas": "192.168.50.10" },
 *   "chains": {
 *     "inbound":  { "default": "block", "enabled": true, "name": "Inbound" },
 *     "outbound": { "default": "allow", "enabled": true, "name": "Outbound" },
 *     "forward":  { "default": "block", "enabled": true, "name": "Forward" }
 *   },
 *   "rules": [
 *     { "name": "Family media", "action": "allow", "from": ["group:family"],
 *       "to": ["device:media-pc"], "protocol": "tcp", "ports": ["8096"] }
 *   ]
 * }
 * ```
 *
 * Deliberate differences from v1:
 *
 * - `tags` are labels on **devices**; `userGroups` are people. They are
 *   separate collections, separate subject kinds (`tag:` / `group:`) and
 *   compile to differently namespaced EasyTier groups.
 * - destination ports are a `ports` list, not a `:port` suffix.
 * - `allow`/`deny` (v1 `accept`/`deny` still parses through the upgrade).
 * - `protocol` includes `icmpv6`.
 * - `stateful` defaults to true: replies of an allowed connection are tracked
 *   (docs/POLICY.md §3; it records the flow, it is not an established match).
 * - per-chain defaults, enabled flag and display name.
 * - `subnet:` subjects name an approved subnet route, so a host behind a
 *   router is addressable as a subject instead of a raw CIDR.
 *
 * NOT part of the document: rule `description` and `priority` (list order sets
 * priority) and chain placement (derived per device by the compiler).
 */

export const POLICY_MODES = ["open", "rules", "json"] as const;
export const POLICY_ACTIONS = ["allow", "deny"] as const;
export const POLICY_PROTOCOLS = ["any", "tcp", "udp", "icmp", "icmpv6"] as const;
export const POLICY_CHAINS = ["inbound", "outbound", "forward"] as const;
export const POLICY_CHAIN_ACTIONS = ["allow", "block"] as const;
/** v1 spelling, still accepted by the upgrade path. */
export const POLICY_ACTION = ["accept", "deny"] as const;
export const POLICY_PROTOCOL = POLICY_PROTOCOLS;

export type PolicyMode = (typeof POLICY_MODES)[number];
export type PolicyAction = (typeof POLICY_ACTIONS)[number];
export type PolicyProtocol = (typeof POLICY_PROTOCOLS)[number];
export type PolicyChainName = (typeof POLICY_CHAINS)[number];
export type PolicyChainAction = (typeof POLICY_CHAIN_ACTIONS)[number];

export interface PolicyChainConfig {
  default: PolicyChainAction;
  enabled: boolean;
  name?: string;
}

export interface PolicyRule {
  name?: string;
  enabled: boolean;
  action: PolicyAction;
  from: string[];
  to: string[];
  protocol: PolicyProtocol;
  /** Destination ports and ranges (`"443"`, `"8000-8100"`); empty = any. */
  ports: string[];
  /** Source ports and ranges; empty = any. */
  sourcePorts: string[];
  stateful: boolean;
  rateLimit?: number;
  burst?: number;
}

export interface PolicySubnet {
  cidr: string;
  via?: string;
}

export interface PolicyUserGroupConfig {
  source: "manual" | "oidc";
  members: string[];
}

export interface PolicyDocument {
  version: 2;
  mode: PolicyMode;
  subnets: Record<string, PolicySubnet>;
  /** Device labels. Bare name -> device DNS names. */
  tags?: Record<string, string[]>;
  /** People. Bare name -> members. Synced (`oidc`) groups are read-only. */
  userGroups?: Record<string, PolicyUserGroupConfig>;
  tagOwners: Record<string, string[]>;
  hosts: Record<string, string>;
  chains: Record<PolicyChainName, PolicyChainConfig>;
  options: { strictTags: boolean; strictGroups: boolean };
  rules: PolicyRule[];
}

export class PolicyValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length > 0 ? `${message}: ${issues.join("; ")}` : message);
    this.name = "PolicyValidationError";
  }
}

const SUBJECT_PATTERNS: Record<"tag" | "group" | "device" | "subnet", RegExp> = {
  tag: /^tag:[a-z0-9][a-z0-9-]{0,62}$/i,
  group: /^group:[a-z0-9][a-z0-9._-]{0,62}$/i,
  device: /^device:[a-z0-9][a-z0-9.-]{0,62}$/i,
  subnet: /^subnet:[a-z0-9][a-z0-9-]{0,62}$/i,
};

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

/** Rejects `tag:web:not-a-port` instead of silently treating it as a tag. */
function checkSubjectName(subject: string, label: string): string[] {
  const kind = subjectKind(subject);
  if (kind === "tag" || kind === "group" || kind === "device" || kind === "subnet") {
    if (!SUBJECT_PATTERNS[kind].test(subject)) {
      return [`${label}: invalid ${kind} subject "${subject}"`];
    }
  }
  return [];
}

export type SubjectKind =
  | "all"
  | "tag"
  | "group"
  | "device"
  | "host"
  | "subnet"
  | "cidr"
  | "unknown";

export function subjectKind(subject: string): SubjectKind {
  if (
    subject === "*" ||
    subject === "anyone" ||
    subject === "anywhere" ||
    subject === "autogroup:all"
  ) {
    return "all";
  }
  if (subject.startsWith("tag:") && subject.length > 4) return "tag";
  if (subject.startsWith("group:") && subject.length > 6) return "group";
  if (subject.startsWith("device:") && subject.length > 7) return "device";
  if (subject.startsWith("host:") && subject.length > 5) return "host";
  if (subject.startsWith("subnet:") && subject.length > 7) return "subnet";
  if (subject.startsWith("cidr:") && subject.length > 5) return "cidr";
  // A bare hostname is treated as a device reference for convenience.
  if (/^[a-z0-9][a-z0-9.-]*$/i.test(subject)) return "device";
  return "unknown";
}

/** Parses one port or range; returns null when it is invalid. */
export function normalizePortSpec(raw: string): string | null {
  const value = raw.trim();
  const range = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(value);
  if (!range) return null;
  const start = Number(range[1]);
  const end = range[2] === undefined ? start : Number(range[2]);
  if (start < 1 || start > 65535 || end < 1 || end > 65535) return null;
  if (range[2] !== undefined && end <= start) return null;
  return range[2] === undefined ? String(start) : `${start}-${end}`;
}

/** Validates a port list, returning normalized values and human errors. */
export function normalizePortList(
  values: readonly string[],
  label: string,
): { ports: string[]; issues: string[] } {
  const issues: string[] = [];
  const ports: string[] = [];
  for (const raw of values) {
    const normalized = normalizePortSpec(raw);
    if (normalized === null) {
      issues.push(`${label}: invalid port or range "${raw}" (1-65535, low < high)`);
      continue;
    }
    if (!ports.includes(normalized)) ports.push(normalized);
  }
  return { ports, issues };
}

/** v1 helper: `tag:web:80,443` -> subject + port spec. */
export function parsePortSpec(
  raw: string,
): { ok: true; ports: string[] } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === "*" || value === "") return { ok: true, ports: [] };
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length > 64) return { ok: false, error: "too many port entries" };
  const ports: string[] = [];
  for (const part of parts) {
    const normalized = normalizePortSpec(part);
    if (normalized === null) {
      return { ok: false, error: `invalid port or range "${part}"` };
    }
    ports.push(normalized);
  }
  return { ok: true, ports };
}

const PORT_SPEC_RE = /^(?:\*|\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*)$/;

/** Splits a v1 destination entry into subject and ports. */
export function splitDestination(raw: string): {
  subject: string;
  ports: string;
  explicitPorts: boolean;
} {
  const value = raw.trim();
  const index = value.lastIndexOf(":");
  if (index <= 0) return { subject: value, ports: "*", explicitPorts: false };
  const suffix = value.slice(index + 1);
  if (!PORT_SPEC_RE.test(suffix)) {
    return { subject: value, ports: "*", explicitPorts: false };
  }
  return { subject: value.slice(0, index), ports: suffix, explicitPorts: true };
}

/** True for an IPv4/IPv6 address or CIDR with a valid prefix. */
export function isIpOrCidr(value: string): boolean {
  const trimmed = value.trim();
  const [address, prefix, extra] = trimmed.split("/");
  if (!address || extra !== undefined) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return family === 4 ? bits <= 32 : bits <= 128;
}

// ---------------------------------------------------------------- v2 schema

const subjectSchema = z.string().min(1).max(253);

const ruleSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    enabled: z.boolean().default(true),
    action: z.enum(POLICY_ACTIONS),
    from: z.array(subjectSchema).min(1).max(256),
    to: z.array(subjectSchema).min(1).max(256),
    protocol: z.enum(POLICY_PROTOCOLS).default("any"),
    ports: z.array(z.string().min(1).max(32)).max(64).default([]),
    sourcePorts: z.array(z.string().min(1).max(32)).max(64).default([]),
    /** EasyTier connection tracking; v2 defaults to true (see docs/POLICY.md). */
    stateful: z.boolean().default(true),
    rateLimit: z.number().int().min(0).max(1_000_000).optional(),
    burst: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

const chainSchema = z
  .object({
    default: z.enum(POLICY_CHAIN_ACTIONS),
    enabled: z.boolean().default(true),
    name: z.string().min(1).max(120).optional(),
  })
  .strict();

/** Accepts `"block"`/"drop" as a shorthand for `{ default: "block" }`. */
const chainInput = z
  .union([
    z.enum(POLICY_CHAIN_ACTIONS),
    z.literal("drop"),
    z.literal("block"),
    z.literal("allow"),
    chainSchema,
  ])
  .transform((value): PolicyChainConfig => {
    if (typeof value === "string") {
      return {
        default: value === "allow" ? "allow" : "block",
        enabled: true,
      };
    }
    return value;
  });

export const DEFAULT_CHAINS: Record<PolicyChainName, PolicyChainConfig> = {
  inbound: { default: "block", enabled: true, name: "easyplane-inbound" },
  outbound: { default: "allow", enabled: true, name: "easyplane-outbound" },
  forward: { default: "block", enabled: true, name: "easyplane-forward" },
};

const subnetSchema = z
  .object({
    cidr: z.string().min(1).max(64),
    via: z.string().min(1).max(253).optional(),
  })
  .strict();

const userGroupSchema = z
  .object({
    source: z.enum(["manual", "oidc"]).default("manual"),
    members: z.array(z.string().min(1).max(253)).max(2_000).default([]),
  })
  .strict();

export const policyDocumentSchema = z
  .object({
    version: z.literal(2).default(2),
    mode: z.enum(POLICY_MODES).default("rules"),
    subnets: z.record(z.string().min(1).max(64), subnetSchema).default({}),
    tags: z.record(z.string().min(1).max(64), z.array(subjectSchema)).optional(),
    userGroups: z.record(z.string().min(1).max(64), userGroupSchema).optional(),
    tagOwners: z.record(z.string(), z.array(subjectSchema)).default({}),
    hosts: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
    chains: z
      .object({
        inbound: chainInput.optional(),
        outbound: chainInput.optional(),
        forward: chainInput.optional(),
      })
      .default({})
      .transform(
        (value): Record<PolicyChainName, PolicyChainConfig> => ({
          inbound: value.inbound ?? { ...DEFAULT_CHAINS.inbound },
          outbound: value.outbound ?? { ...DEFAULT_CHAINS.outbound },
          forward: value.forward ?? { ...DEFAULT_CHAINS.forward },
        }),
      ),
    options: z
      .object({
        strictTags: z.boolean().default(false),
        strictGroups: z.boolean().default(false),
      })
      .strict()
      .default({ strictTags: false, strictGroups: false }),
    rules: z.array(ruleSchema).max(60_000).default([]),
  })
  .strict();

// ------------------------------------------------------------ v1 upgrade

interface V1Statement {
  name?: string;
  action: "accept" | "deny";
  src: string[];
  dst: string[];
  proto?: PolicyProtocol;
  rateLimit?: number;
  burst?: number;
  stateful?: boolean;
}

function isV1Document(input: Record<string, unknown>): boolean {
  return (
    input.version === 1 ||
    (input.version === undefined && Array.isArray(input.acls)) ||
    (Array.isArray(input.acls) && !Array.isArray(input.rules))
  );
}

function bareName(value: string, prefixes: readonly string[]): string {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix) && value.length > prefix.length) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

/**
 * Converts a v1 document to v2 without losing information.
 *
 * - `acls` -> `rules`: `accept` -> `allow`, `proto` -> `protocol`, the destination
 *   `:port` suffix -> `ports`, `stateful` defaults to true (v2 semantics).
 * - `groups` (`group:ops` -> emails/IdP groups) -> `userGroups` with manual
 *   members. The service applies those to the user-group tables on save.
 * - `tagOwners`, `hosts` and `options` carry over; `strictTags` implies
 *   `strictGroups` too, because both are people/device group proofs now.
 * - chain defaults come from v1's fixed behaviour: inbound block, outbound
 *   allow, forward block.
 */
export function upgradeV1Document(input: Record<string, unknown>): PolicyDocument {
  const issues: string[] = [];
  const acls = Array.isArray(input.acls) ? (input.acls as V1Statement[]) : [];
  const rules: PolicyRule[] = acls.map((statement, index) => {
    const label = statement.name ?? `acls[${index}]`;
    if (statement.action !== "accept" && statement.action !== "deny") {
      issues.push(`${label}: action must be "accept" or "deny"`);
    }
    const ports: string[] = [];
    for (const entry of statement.dst ?? []) {
      const { ports: portSpec } = splitDestination(entry);
      const parsed = parsePortSpec(portSpec);
      if (!parsed.ok) {
        issues.push(`${label}: destination "${entry}": ${parsed.error}`);
        continue;
      }
      for (const port of parsed.ports) if (!ports.includes(port)) ports.push(port);
    }
    return {
      ...(statement.name ? { name: statement.name } : {}),
      enabled: true,
      action: statement.action === "accept" ? "allow" : "deny",
      from: (statement.src ?? []).map((entry) => entry.trim()),
      to: (statement.dst ?? []).map((entry) => splitDestination(entry).subject),
      protocol: statement.proto ?? "any",
      ports,
      sourcePorts: [],
      // v1 wrote `stateful: false` unless asked. The compiler marks allows
      // stateful by default now; an explicit false is preserved below.
      stateful: statement.stateful ?? true,
      ...(statement.rateLimit !== undefined ? { rateLimit: statement.rateLimit } : {}),
      ...(statement.burst !== undefined ? { burst: statement.burst } : {}),
    };
  });

  const groups = (input.groups ?? {}) as Record<string, unknown>;
  const userGroups: Record<string, PolicyUserGroupConfig> = {};
  for (const [key, members] of Object.entries(groups)) {
    if (!Array.isArray(members)) continue;
    userGroups[bareName(key, ["group:"])] = {
      source: "manual",
      members: members.map((member) => String(member)),
    };
  }

  const options = (input.options ?? {}) as { strictTags?: boolean };
  const document: PolicyDocument = {
    version: 2,
    mode: "rules",
    subnets: {},
    ...(Object.keys(userGroups).length > 0 ? { userGroups } : {}),
    tagOwners: (input.tagOwners ?? {}) as Record<string, string[]>,
    hosts: (input.hosts ?? {}) as Record<string, string>,
    chains: {
      inbound: { ...DEFAULT_CHAINS.inbound },
      outbound: { ...DEFAULT_CHAINS.outbound },
      forward: { ...DEFAULT_CHAINS.forward },
    },
    options: {
      strictTags: options.strictTags === true,
      strictGroups: options.strictTags === true,
    },
    rules,
  };
  if (issues.length > 0) {
    throw new PolicyValidationError("policy document is invalid", issues);
  }
  return document;
}

// ---------------------------------------------------------- normalisation

export interface NormalizeResult {
  document: PolicyDocument;
  /** True when a v1 document was upgraded to v2. */
  upgradedFromV1: boolean;
}

/** Validates a parsed document (v1 or v2) and returns a v2 document. */
export function normalizePolicyDocumentWithMeta(input: unknown): NormalizeResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PolicyValidationError("policy document must be a JSON object");
  }
  const record = input as Record<string, unknown>;
  let upgradedFromV1 = false;
  let candidate: unknown = record;
  if (isV1Document(record)) {
    upgradedFromV1 = true;
    candidate = upgradeV1Document(record);
  }
  const parsed = policyDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new PolicyValidationError(
      "policy document is invalid",
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  const document = parsed.data;
  const issues = validateDocument(document);
  if (issues.length > 0) {
    throw new PolicyValidationError("policy document is invalid", issues);
  }
  return { document, upgradedFromV1 };
}

export function normalizePolicyDocument(input: unknown): PolicyDocument {
  return normalizePolicyDocumentWithMeta(input).document;
}

function validateDocument(document: PolicyDocument): string[] {
  const issues: string[] = [];

  for (const [alias, subnet] of Object.entries(document.subnets)) {
    if (!NAME_PATTERN.test(alias)) {
      issues.push(`subnets["${alias}"]: alias must be a plain name`);
    }
    if (!isIpOrCidr(subnet.cidr)) {
      issues.push(`subnets["${alias}"].cidr: "${subnet.cidr}" is not an IP or CIDR`);
    }
    if (subnet.via !== undefined && !NAME_PATTERN.test(subnet.via)) {
      issues.push(`subnets["${alias}"].via: "${subnet.via}" is not a device name`);
    }
  }
  for (const [name, devices] of Object.entries(document.tags ?? {})) {
    if (!NAME_PATTERN.test(name)) {
      issues.push(`tags["${name}"]: tag names must be plain names (letters, digits, . _ -)`);
    }
    for (const device of devices) {
      if (!NAME_PATTERN.test(device)) {
        issues.push(`tags["${name}"]: "${device}" is not a device name`);
      }
    }
  }
  for (const [name, group] of Object.entries(document.userGroups ?? {})) {
    if (!NAME_PATTERN.test(name)) {
      issues.push(`userGroups["${name}"]: group names must be plain names`);
    }
    // v1 groups accepted IdP group names as well as emails for compatibility;
    // both are preserved. Synced groups (`source: oidc`) are read-only and
    // derive their members from the users' IdP claims.
  }
  for (const key of Object.keys(document.tagOwners)) {
    if (subjectKind(key) !== "tag") {
      issues.push(`tagOwners["${key}"]: tag names must look like "tag:server"`);
    }
  }
  for (const [alias, value] of Object.entries(document.hosts)) {
    if (subjectKind(alias) !== "device" && alias.includes(":")) {
      issues.push(`hosts["${alias}"]: alias must be a plain name`);
    }
    if (!isIpOrCidr(value)) {
      issues.push(`hosts["${alias}"]: "${value}" is not an IP address/CIDR`);
    }
  }
  for (const chain of POLICY_CHAINS) {
    const config = document.chains[chain];
    if (!config) {
      issues.push(`chains.${chain}: missing (the default is "${DEFAULT_CHAINS[chain].default}")`);
    }
  }

  const names = new Set<string>();
  document.rules.forEach((rule, index) => {
    const label = rule.name ?? `rules[${index}]`;
    if (rule.name) {
      if (names.has(rule.name)) {
        issues.push(`rules[${index}]: duplicate rule name "${rule.name}"`);
      }
      names.add(rule.name);
    }
    const ports = normalizePortList(rule.ports, `${label}: ports`);
    issues.push(...ports.issues);
    const sourcePorts = normalizePortList(rule.sourcePorts, `${label}: sourcePorts`);
    issues.push(...sourcePorts.issues);
    if (
      (rule.protocol === "icmp" || rule.protocol === "icmpv6" || rule.protocol === "any") &&
      rule.ports.length > 0
    ) {
      // EasyTier only checks ports when the packet carries one, so an ICMP /
      // Any rule with ports is not an error upstream. Warn through validation
      // only when the protocol is explicitly ICMP, where it can never match a
      // port; `any` still matches TCP.
      if (rule.protocol !== "any") {
        issues.push(`${label}: protocol ${rule.protocol} cannot match a port list`);
      }
    }
    if (rule.sourcePorts.length > 0 && rule.protocol === "icmp") {
      issues.push(`${label}: protocol icmp cannot match source ports`);
    }
    for (const subject of [...rule.from, ...rule.to]) {
      const kind = subjectKind(subject);
      issues.push(...checkSubjectName(subject, label));
      if (kind === "unknown") {
        issues.push(`${label}: unknown subject "${subject}"`);
      }
      if (kind === "host") {
        const alias = subject.slice("host:".length);
        if (!(alias in document.hosts)) {
          issues.push(`${label}: hosts["${alias}"] is not defined`);
        }
      }
      if (kind === "subnet") {
        const alias = subject.slice("subnet:".length);
        if (!(alias in document.subnets)) {
          issues.push(`${label}: subnets["${alias}"] is not defined`);
        }
      }
      if (kind === "cidr") {
        const value = subject.slice("cidr:".length);
        if (!isIpOrCidr(value)) {
          issues.push(`${label}: "${value}" is not an IP address/CIDR`);
        }
      }
    }
    if (rule.rateLimit !== undefined && rule.rateLimit > 0) {
      if ((rule.burst ?? 0) === 0) {
        // EasyTier would start with an empty bucket and drop everything until
        // a token accumulates. Refuse to surprise operators.
        issues.push(`${label}: rateLimit requires a non-zero burst`);
      }
    }
  });
  return issues;
}

/** HuJSON text -> validated v2 policy document. */
export function parsePolicyText(text: string): PolicyDocument {
  let raw: unknown;
  try {
    raw = parseHuJson(text);
  } catch (error) {
    throw new PolicyValidationError(
      error instanceof Error ? error.message : "invalid HuJSON",
    );
  }
  return normalizePolicyDocument(raw);
}

/** A compact, human-readable summary used by the UI and audit log. */
export function describePolicy(document: PolicyDocument): {
  statements: number;
  tags: string[];
  groups: string[];
  hosts: string[];
  subnets: string[];
  strictTags: boolean;
  strictGroups: boolean;
  mode: PolicyMode;
  chains: Record<PolicyChainName, PolicyChainConfig>;
} {
  const tags = new Set<string>();
  const groups = new Set<string>();
  for (const rule of document.rules) {
    for (const subject of [...rule.from, ...rule.to]) {
      const kind = subjectKind(subject);
      if (kind === "tag") tags.add(subject.slice("tag:".length));
      if (kind === "group") groups.add(subject.slice("group:".length));
    }
  }
  for (const name of Object.keys(document.tags ?? {})) tags.add(bareName(name, ["tag:"]));
  for (const name of Object.keys(document.userGroups ?? {})) {
    groups.add(bareName(name, ["group:"]));
  }
  for (const key of Object.keys(document.tagOwners)) {
    tags.add(bareName(key, ["tag:"]));
  }
  return {
    statements: document.rules.length,
    tags: [...tags].sort(),
    groups: [...groups].sort(),
    hosts: Object.keys(document.hosts).sort(),
    subnets: Object.keys(document.subnets).sort(),
    strictTags: document.options.strictTags,
    strictGroups: document.options.strictGroups,
    mode: document.mode,
    chains: document.chains,
  };
}
