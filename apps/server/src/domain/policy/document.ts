import { z } from "zod";

import { parseHuJson } from "./hujson.js";

/**
 * EasyPlane policy document (M2).
 *
 * The shape is deliberately close to Tailscale's ACL file so a policy can be
 * pasted after the tag/group names are adapted:
 *
 * ```jsonc
 * {
 *   "groups":    { "group:ops": ["alice@example.com", "engineering"] },
 *   "tagOwners": { "tag:server": ["group:ops"] },
 *   "hosts":     { "nas": "192.168.1.10" },
 *   "options":   { "strictTags": false },
 *   "acls": [
 *     { "name": "web-to-db", "action": "accept",
 *       "src": ["tag:web"], "dst": ["tag:db:5432"], "proto": "tcp" }
 *   ]
 * }
 * ```
 *
 * Subjects: `*`/`autogroup:all`, `tag:<name>`, `group:<name>`,
 * `device:<hostname>`, `host:<alias>`, `cidr:<v4 cidr>` (destination and
 * forward sources only).
 */

export const POLICY_ACTION = ["accept", "deny"] as const;
export const POLICY_PROTOCOL = ["any", "tcp", "udp", "icmp"] as const;

const subjectSchema = z.string().min(1).max(253);

const statementSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    action: z.enum(POLICY_ACTION),
    src: z.array(subjectSchema).min(1).max(256),
    dst: z.array(subjectSchema).min(1).max(256),
    /** Protocol for the destination ports; `any` (default) matches all. */
    proto: z.enum(POLICY_PROTOCOL).default("any"),
    /** Packets per second for an accepted flow (EasyTier `rate_limit`). */
    rateLimit: z.number().int().min(0).max(1_000_000).optional(),
    /** Token bucket burst for `rateLimit` (EasyTier `burst_limit`). */
    burst: z.number().int().min(0).max(1_000_000).optional(),
    /** Ask EasyTier to keep connection tracking for this rule. */
    stateful: z.boolean().optional(),
  })
  .strict();

export const policyDocumentSchema = z
  .object({
    /** Document format version; only 1 is understood. */
    version: z.literal(1).optional(),
    groups: z.record(z.string(), z.array(z.string().min(1).max(253))).default({}),
    tagOwners: z.record(z.string(), z.array(z.string().min(1).max(253))).default({}),
    hosts: z.record(z.string(), z.string().min(1).max(64)).default({}),
    options: z
      .object({
        /**
         * Add EasyTier group criteria (verified group membership proofs) to
         * allow rules whose source is a tag. Spoof resistant, but the
         * destination must hold the tag's group secret.
         */
        strictTags: z.boolean().default(false),
      })
      .strict()
      .default({ strictTags: false }),
    acls: z.array(statementSchema).max(60_000).default([]),
  })
  .strict();

export type PolicyDocument = z.infer<typeof policyDocumentSchema>;
export type PolicyStatement = z.infer<typeof statementSchema>;
export type PolicyAction = (typeof POLICY_ACTION)[number];
export type PolicyProtocol = (typeof POLICY_PROTOCOL)[number];

export class PolicyValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length > 0 ? `${message}: ${issues.join("; ")}` : message);
    this.name = "PolicyValidationError";
  }
}

const SUBJECT_PATTERNS: Record<"tag" | "group" | "device", RegExp> = {
  tag: /^tag:[a-z0-9][a-z0-9-]{0,62}$/i,
  group: /^group:[a-z0-9][a-z0-9._-]{0,62}$/i,
  device: /^device:[a-z0-9][a-z0-9.-]{0,62}$/i,
};

/** Rejects `tag:web:not-a-port` instead of silently treating it as a tag. */
function checkSubjectName(subject: string, label: string): string[] {
  const kind = subjectKind(subject);
  if (kind === "tag" || kind === "group" || kind === "device") {
    if (!SUBJECT_PATTERNS[kind].test(subject)) {
      return [`${label}: invalid ${kind} subject "${subject}"`];
    }
  }
  return [];
}

/** Parses the port part of a destination; `*` means every port. */
export function parsePortSpec(
  raw: string,
): { ok: true; ports: string[] } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === "*" || value === "") return { ok: true, ports: [] };
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length > 64) return { ok: false, error: "too many port entries" };
  const ports: string[] = [];
  for (const part of parts) {
    const range = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part);
    if (!range) {
      return { ok: false, error: `invalid port or range "${part}"` };
    }
    const start = Number(range[1]);
    const end = range[2] === undefined ? start : Number(range[2]);
    if (start > 65535 || end > 65535) {
      return { ok: false, error: `port out of range in "${part}"` };
    }
    if (end < start) {
      return { ok: false, error: `port range "${part}" ends before it starts` };
    }
    ports.push(range[2] === undefined ? String(start) : `${start}-${end}`);
  }
  return { ok: true, ports };
}

const PORT_SPEC_RE = /^(?:\*|\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*)$/;

/**
 * Splits a destination entry into subject and ports. Subjects themselves
 * contain `:`, so the port part is only recognised when the last segment looks
 * like a port list (`tag:web:80,443`, `cidr:10.0.0.0/24:443`).
 */
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
  return {
    subject: value.slice(0, index),
    ports: suffix,
    explicitPorts: true,
  };
}

export function subjectKind(
  subject: string,
):
  | "all"
  | "tag"
  | "group"
  | "device"
  | "host"
  | "cidr"
  | "unknown" {
  if (subject === "*" || subject === "autogroup:all") return "all";
  if (subject.startsWith("tag:") && subject.length > 4) return "tag";
  if (subject.startsWith("group:") && subject.length > 6) return "group";
  if (subject.startsWith("device:") && subject.length > 7) return "device";
  if (subject.startsWith("host:") && subject.length > 5) return "host";
  if (subject.startsWith("cidr:") && subject.length > 5) return "cidr";
  // A bare hostname is treated as a device reference for convenience.
  if (/^[a-z0-9][a-z0-9.-]*$/i.test(subject)) return "device";
  return "unknown";
}

/** Validates a parsed document and returns it with defaults applied. */
export function normalizePolicyDocument(input: unknown): PolicyDocument {
  const parsed = policyDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new PolicyValidationError(
      "policy document is invalid",
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  const document = parsed.data;
  const issues: string[] = [];

  for (const key of Object.keys(document.groups)) {
    if (!key.startsWith("group:") || key.length <= 6) {
      issues.push(`groups["${key}"]: group names must look like "group:ops"`);
    }
  }
  for (const key of Object.keys(document.tagOwners)) {
    if (!key.startsWith("tag:") || key.length <= 4) {
      issues.push(`tagOwners["${key}"]: tag names must look like "tag:server"`);
    }
  }
  for (const [alias, value] of Object.entries(document.hosts)) {
    if (subjectKind(alias) !== "device" && alias.includes(":")) {
      issues.push(`hosts["${alias}"]: alias must be a plain name`);
    }
    if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)) {
      issues.push(`hosts["${alias}"]: "${value}" is not an IPv4 address/CIDR`);
    }
  }

  const names = new Set<string>();
  document.acls.forEach((statement, index) => {
    const label = statement.name ?? `acls[${index}]`;
    if (statement.name) {
      if (names.has(statement.name)) {
        issues.push(`acls[${index}]: duplicate statement name "${statement.name}"`);
      }
      names.add(statement.name);
    }
    for (const src of statement.src) {
      const kind = subjectKind(src);
      issues.push(...checkSubjectName(src, label));
      if (kind === "unknown") {
        issues.push(`${label}: unknown source subject "${src}"`);
      }
      if (kind === "host") {
        const alias = src.slice("host:".length);
        if (!(alias in document.hosts)) {
          issues.push(`${label}: hosts["${alias}"] is not defined`);
        }
      }
    }
    statement.dst.forEach((dst) => {
      const { subject, ports } = splitDestination(dst);
      const kind = subjectKind(subject);
      issues.push(...checkSubjectName(subject, label));
      if (kind === "unknown") {
        issues.push(`${label}: unknown destination subject "${dst}"`);
      }
      if (kind === "host") {
        const alias = subject.slice("host:".length);
        if (!(alias in document.hosts)) {
          issues.push(`${label}: hosts["${alias}"] is not defined`);
        }
      }
      const parsedPorts = parsePortSpec(ports);
      if (!parsedPorts.ok) {
        issues.push(`${label}: destination "${dst}": ${parsedPorts.error}`);
      }
    });
    if (statement.rateLimit !== undefined && statement.rateLimit > 0) {
      const burst = statement.burst ?? 0;
      if (burst === 0) {
        // EasyTier accepts it, but the bucket would start empty and drop
        // everything until a token accumulates. Refuse to surprise operators.
        issues.push(`${label}: rateLimit requires a non-zero burst`);
      }
    }
  });

  if (issues.length > 0) {
    throw new PolicyValidationError("policy document is invalid", issues);
  }
  return document;
}

/** HuJSON text -> validated policy document. */
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
  strictTags: boolean;
} {
  const tags = new Set<string>();
  for (const statement of document.acls) {
    for (const subject of [...statement.src, ...statement.dst]) {
      const { subject: base } = splitDestination(subject);
      if (subjectKind(base) === "tag") tags.add(base);
    }
  }
  for (const key of Object.keys(document.tagOwners)) tags.add(key);
  return {
    statements: document.acls.length,
    tags: [...tags].sort(),
    groups: Object.keys(document.groups).sort(),
    hosts: Object.keys(document.hosts).sort(),
    strictTags: document.options.strictTags,
  };
}
