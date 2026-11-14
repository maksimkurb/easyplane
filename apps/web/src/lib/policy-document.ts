/**
 * Conversion between the policy JSON document and the table form in the panel.
 * Kept out of the page so it can be unit-tested (the server is the authority on
 * validation either way).
 */

export interface StatementRow {
  name: string
  action: "accept" | "deny"
  src: string
  dst: string
  proto: "any" | "tcp" | "udp" | "icmp"
  rateLimit: string
  burst: string
  stateful: boolean
}

export interface PolicyDocumentShape {
  groups?: Record<string, string[]>
  tagOwners?: Record<string, string[]>
  hosts?: Record<string, string>
  options?: { strictTags?: boolean }
  acls?: Array<{
    name?: string
    action: "accept" | "deny"
    src: string[]
    dst: string[]
    proto?: "any" | "tcp" | "udp" | "icmp"
    rateLimit?: number
    burst?: number
    stateful?: boolean
  }>
}

export const EMPTY_POLICY_DOCUMENT: PolicyDocumentShape = {
  groups: {},
  tagOwners: {},
  hosts: {},
  options: { strictTags: false },
  acls: [],
}

export function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function toStatementRows(document: PolicyDocumentShape): StatementRow[] {
  return (document.acls ?? []).map((statement) => ({
    name: statement.name ?? "",
    action: statement.action,
    src: statement.src.join(", "),
    dst: statement.dst.join(", "),
    proto: statement.proto ?? "any",
    rateLimit: statement.rateLimit ? String(statement.rateLimit) : "",
    burst: statement.burst ? String(statement.burst) : "",
    stateful: statement.stateful === true,
  }))
}

export function toPolicyDocument(
  rows: StatementRow[],
  base: PolicyDocumentShape,
): Record<string, unknown> {
  return {
    ...base,
    acls: rows
      .filter((row) => row.src.trim() !== "" && row.dst.trim() !== "")
      .map((row) => ({
        ...(row.name.trim() ? { name: row.name.trim() } : {}),
        action: row.action,
        src: splitList(row.src),
        dst: splitList(row.dst),
        proto: row.proto,
        ...(row.rateLimit ? { rateLimit: Number(row.rateLimit) } : {}),
        ...(row.burst ? { burst: Number(row.burst) } : {}),
        ...(row.stateful ? { stateful: true } : {}),
      })),
  }
}

