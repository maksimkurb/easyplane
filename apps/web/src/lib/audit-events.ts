import type { ListAuditLog200Item } from "@/api/generated/model"

export type AuditCategory = "signin" | "access" | "devices" | "invites"
export type AuditFilter = "all" | AuditCategory

/**
 * Audit actions are ordinary dotted strings. The UI groups them into the four
 * questions a beginner actually asks: who signed in, what changed about
 * access, what happened to devices, and which invites exist.
 */
export function auditCategory(action: string): AuditCategory | null {
  if (action.startsWith("auth.")) return "signin"
  if (
    action.startsWith("policy.") ||
    action.startsWith("credential.") ||
    action.startsWith("tag.") ||
    action.startsWith("user_group.") ||
    action.startsWith("network.")
  ) {
    return "access"
  }
  if (
    action.startsWith("device.") ||
    action.startsWith("route.") ||
    action.startsWith("wireguard_")
  )
    return "devices"
  if (action.startsWith("invite.")) return "invites"
  return null
}

/** Unknown actions still get a readable sentence instead of a raw code. */
export function humanizeAuditAction(action: string): string {
  const words = action.replace(/[._]+/g, " ").trim()
  if (!words) return "Unknown event"
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Flat i18n keys: i18next treats dots as path separators, so an action name is
 * normalised once here and every lookup stays a single flat key.
 */
export function auditEventKey(action: string): string {
  return `audit.events.${action.replace(/[._]+/g, "_")}`
}

/** System events that are one noise-free sentence when grouped. */
const GROUPABLE_SYSTEM_ACTIONS = new Set([
  "device.config.pushed",
  "device.config.push_failed",
])

export function isGroupableAuditEntry(entry: ListAuditLog200Item): boolean {
  return (
    entry.actorType === "system" &&
    entry.actorUserId === null &&
    GROUPABLE_SYSTEM_ACTIONS.has(entry.action)
  )
}

/** Reads an untyped audit metadata value without leaking `unknown` into JSX. */
export function metadataString(
  entry: ListAuditLog200Item,
  key: string
): string | null {
  const value = entry.metadata[key]
  if (typeof value === "string" && value.trim()) return value
  if (typeof value === "number") return String(value)
  return null
}

export function shortId(value: string | null | undefined): string {
  if (!value) return "—"
  return value.slice(0, 8)
}
