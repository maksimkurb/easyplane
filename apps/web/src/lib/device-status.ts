import type { TFunction } from "i18next"

import type { ListDevices200Item } from "@/api/generated/model"

/**
 * The one status model for a device.
 *
 * The API exposes three independent dimensions (approval `state`, `online` and
 * config `sync`) and the UI used to render all three side by side, so a device
 * could look "online", "stale" and "error" at once. This module folds them into
 * a single status with a fixed priority, and every screen in the device area
 * reads it instead of looking at the raw fields.
 *
 * Priority (highest wins):
 *  1. blocked           — the device is refused, nothing else matters
 *  2. pending           — waiting for an admin to approve it
 *  3. offline           — not connected; config problems are hidden, not scolded
 *  4. updating          — online, but a newer config revision is queued
 *  5. push-failed       — online and the last push failed
 *  6. online            — connected and running the desired revision
 */
export type DeviceStatusKind =
  "blocked" | "pending" | "offline" | "updating" | "push-failed" | "online"

export type DeviceStatusTone = "muted" | "info" | "warn" | "err" | "ok"

/** The fields a derived status needs; both list rows and the detail API have them. */
export interface DeviceStatusInput {
  state: ListDevices200Item["state"]
  online: ListDevices200Item["online"]
  sync: ListDevices200Item["sync"]
  lastPushError?: string | null
  desiredRevision?: number | null
  appliedRevision?: number | null
}

export interface DeviceStatus {
  kind: DeviceStatusKind
  tone: DeviceStatusTone
  /** The device is connected to the mesh right now. */
  connected: boolean
  /** Status 2, 4 or 5: there is something for a person to do or watch. */
  needsAttention: boolean
  /** Revision queued for the next successful push, when it differs from the running one. */
  pendingRevision: number | null
  /** The reason the client reported for the last failed push, if any. */
  reason: string | null
}

const TONES: Record<DeviceStatusKind, DeviceStatusTone> = {
  blocked: "muted",
  pending: "info",
  offline: "muted",
  updating: "warn",
  "push-failed": "err",
  online: "ok",
}

const ATTENTION: Record<DeviceStatusKind, boolean> = {
  blocked: false,
  pending: true,
  offline: false,
  updating: true,
  "push-failed": true,
  online: false,
}

export function deriveDeviceStatus(input: DeviceStatusInput): DeviceStatus {
  const desired = input.desiredRevision ?? null
  const applied = input.appliedRevision ?? null
  const pendingRevision =
    desired !== null && applied !== desired ? desired : null
  const reason = input.lastPushError?.trim() ? input.lastPushError.trim() : null
  const connected = input.online === "online" && input.state === "approved"

  const status = (kind: DeviceStatusKind): DeviceStatus => ({
    kind,
    tone: TONES[kind],
    connected,
    needsAttention: ATTENTION[kind],
    pendingRevision,
    reason,
  })

  // 1. A blocked device cannot connect, so config freshness is irrelevant.
  if (input.state === "blocked") return status("blocked")

  // 2. Waiting for approval: it has no config to apply yet.
  if (input.state === "pending") return status("pending")

  // 3. Offline: never report config problems for a device we cannot reach.
  if (input.online !== "online") return status("offline")

  // 5. A reported push error beats "stale": it explains why the config is old.
  if (reason !== null || input.sync === "error") return status("push-failed")

  // 4. Online but a different revision is queued (or the API says stale).
  if (pendingRevision !== null || input.sync === "stale")
    return status("updating")

  // 6. Everything is where it should be.
  return status("online")
}

/** True when a device row should appear under "Needs attention". */
export function deviceNeedsAttention(input: DeviceStatusInput): boolean {
  return deriveDeviceStatus(input).needsAttention
}

/**
 * The display name is primary; the reported hostname is only worth showing
 * when it is different (MagicDNS renames make them diverge).
 */
export function deviceDisplayName(device: {
  dnsName?: string | null
  hostname?: string | null
  machineId: string
}): string {
  return device.dnsName || device.hostname || device.machineId.slice(0, 8)
}

/** Secondary hostname for the detail page, or null when it adds no information. */
export function deviceSecondaryHostname(device: {
  dnsName?: string | null
  hostname?: string | null
  machineId: string
}): string | null {
  const name = deviceDisplayName(device)
  if (!device.hostname || device.hostname === name) return null
  return device.hostname
}

/** Tags are stored and displayed without the legacy "tag:" prefix. */
export function tagLabel(tag: string): string {
  return tag.replace(/^tag:/, "")
}

const LABEL_KEY: Record<DeviceStatusKind, string> = {
  blocked: "deviceStatus.labels.blocked",
  pending: "deviceStatus.labels.pending",
  offline: "deviceStatus.labels.offline",
  updating: "deviceStatus.labels.updating",
  "push-failed": "deviceStatus.labels.pushFailed",
  online: "deviceStatus.labels.online",
}

/** Short, consistent label for a derived status. */
export function deviceStatusText(t: TFunction, status: DeviceStatus): string {
  return t(LABEL_KEY[status.kind])
}

/**
 * One sentence that explains the status. Never scolds an offline device for a
 * config problem: it only says what will happen when it comes back.
 */
export function deviceStatusDetail(
  t: TFunction,
  status: DeviceStatus
): string | null {
  switch (status.kind) {
    case "blocked":
      return t("deviceStatus.hint.blocked")
    case "pending":
      return t("deviceStatus.hint.pending")
    case "offline":
      return status.pendingRevision !== null
        ? t("deviceStatus.hint.offlinePending", {
            revision: status.pendingRevision,
          })
        : t("deviceStatus.hint.offline")
    case "updating":
      return status.pendingRevision !== null
        ? t("deviceStatus.hint.updating", { revision: status.pendingRevision })
        : t("deviceStatus.hint.updatingUnknown")
    case "push-failed":
      return status.reason
        ? t("deviceStatus.hint.pushFailedReason", { reason: status.reason })
        : t("deviceStatus.hint.pushFailed")
    case "online":
      return null
  }
}
