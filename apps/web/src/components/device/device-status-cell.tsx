import { useTranslation } from "react-i18next"

import { DeviceStatusDot } from "@/components/device-status"
import {
  deriveDeviceStatus,
  deviceStatusDetail,
  deviceStatusText,
  type DeviceStatusInput,
} from "@/lib/device-status"
import { formatDateTime, formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The single status line used by the device list, the detail header and the map
 * panel: one dot plus one label, with the explanation and the absolute time in
 * the tooltip. Never two contradictory signals.
 */
export function DeviceStatusCell({
  device,
  showHint = false,
  className,
}: {
  device: DeviceStatusInput & { lastSeenAt?: string | null }
  /** Show the offline "will update …" hint as a second line. */
  showHint?: boolean
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const status = deriveDeviceStatus(device)
  const relative = formatRelativeTime(device.lastSeenAt, i18n.language)
  const absolute = device.lastSeenAt
    ? formatDateTime(device.lastSeenAt, i18n.language)
    : null
  const detail = deviceStatusDetail(t, status)

  const label =
    status.kind === "offline" && relative
      ? relative
      : deviceStatusText(t, status)
  const hint =
    status.kind === "offline" && status.pendingRevision !== null
      ? t("deviceStatus.hint.offlinePending", {
          revision: status.pendingRevision,
        })
      : null

  const tooltip = [
    status.kind === "offline" && absolute
      ? t("deviceStatus.lastSeenAt", { time: absolute })
      : null,
    detail,
  ]
    .filter(Boolean)
    .join(" · ")

  const screenReaderLabel = [
    deviceStatusText(t, status),
    status.kind === "offline" && relative
      ? t("deviceStatus.lastSeenAt", { time: relative })
      : null,
    detail,
  ]
    .filter(Boolean)
    .join(". ")

  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2 text-[13px] text-fg-2",
        className
      )}
      title={tooltip || undefined}
    >
      <DeviceStatusDot status={status} />
      <span aria-hidden="true" className="min-w-0">
        <span className="block truncate">{label}</span>
        {showHint && hint ? (
          <span className="block truncate text-xs text-fg-3">{hint}</span>
        ) : null}
      </span>
      <span className="sr-only">{screenReaderLabel}</span>
    </span>
  )
}
