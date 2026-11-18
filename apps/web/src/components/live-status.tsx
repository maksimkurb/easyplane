import { useTranslation } from "react-i18next"

import { useRealtime } from "@/realtime/context"
import { cn } from "@/lib/utils"

const colors: Record<string, string> = {
  live: "bg-ok-dot ring-3 ring-ok-soft",
  connecting: "bg-warn",
  reconnecting: "bg-warn",
  offline: "bg-fg-3/50",
}

/**
 * Reports the state of the panel's realtime connection, not the devices.
 * "Live updates" means events arrive without a refresh; a device can still be
 * offline while updates are live, and the label must not imply otherwise.
 */
export function LiveStatus({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { status } = useRealtime()
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground",
        className
      )}
      title={t("deviceStatus.realtime.hint")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 flex-none rounded-full",
          colors[status] ?? colors.offline
        )}
      />
      {t(`deviceStatus.realtime.${status}`)}
    </span>
  )
}
