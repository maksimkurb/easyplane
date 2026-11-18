import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Chip } from "@/components/ui/chip"
import {
  deriveDeviceStatus,
  deviceStatusDetail,
  deviceStatusText,
  type DeviceStatus,
  type DeviceStatusInput,
  type DeviceStatusKind,
  type DeviceStatusTone,
} from "@/lib/device-status"
import { cn } from "@/lib/utils"

const DOT_CLASS: Record<DeviceStatusKind, string> = {
  blocked: "bg-fg-3",
  pending: "bg-brand",
  offline: "bg-fg-3/60",
  updating: "bg-warn",
  "push-failed": "bg-err",
  online: "bg-ok-dot ring-3 ring-ok-soft",
}

const CHIP_VARIANT: Record<
  DeviceStatusTone,
  "neutral" | "brand" | "warn" | "err" | "ok"
> = {
  muted: "neutral",
  info: "brand",
  warn: "warn",
  err: "err",
  ok: "ok",
}

/** Coloured dot. Decorative: the label next to it carries the meaning. */
export function DeviceStatusDot({
  status,
  className,
}: {
  status: DeviceStatus
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 flex-none rounded-full",
        DOT_CLASS[status.kind],
        className
      )}
    />
  )
}

/**
 * The single status badge. A blocked device is struck through so the state is
 * not conveyed by colour alone.
 */
export function DeviceStatusBadge({
  status,
  className,
}: {
  status: DeviceStatus
  className?: string
}) {
  const { t } = useTranslation()
  const detail = deviceStatusDetail(t, status)
  return (
    <Chip
      className={cn(
        "gap-1.5",
        status.kind === "blocked" && "line-through",
        className
      )}
      title={detail ?? undefined}
      variant={CHIP_VARIANT[status.tone]}
    >
      <DeviceStatusDot className="size-1.5" status={status} />
      {deviceStatusText(t, status)}
    </Chip>
  )
}

/**
 * Backwards-compatible entry point for screens that only have the three raw
 * API dimensions (the global devices table and the topology drawer). It renders
 * one derived badge instead of the old three independent ones.
 */
export function DeviceStatusBadges({
  state,
  online,
  sync,
  lastPushError,
  desiredRevision,
  appliedRevision,
  className,
}: DeviceStatusInput & { className?: string }) {
  const status = deriveDeviceStatus({
    state,
    online,
    sync,
    lastPushError,
    desiredRevision,
    appliedRevision,
  })
  return <DeviceStatusBadge className={className} status={status} />
}

export function InviteStatusBadge({
  status,
}: {
  status: "active" | "expired" | "exhausted" | "revoked"
}) {
  const { t } = useTranslation()
  const className =
    status === "active"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "expired" || status === "exhausted"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
  return (
    <Badge className={cn("border", className)} variant="outline">
      {t(`invites.status.${status}`)}
    </Badge>
  )
}
