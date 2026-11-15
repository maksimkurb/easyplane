import { useTranslation } from "react-i18next"

import { useRealtime } from "@/realtime/context"
import { cn } from "@/lib/utils"

const colors: Record<string, string> = {
  live: "bg-emerald-500",
  connecting: "bg-amber-500",
  reconnecting: "bg-amber-500",
  offline: "bg-muted-foreground/50",
}

/** Small indicator that the panel is receiving server events. */
export function LiveStatus() {
  const { t } = useTranslation()
  const { status, lastSeq } = useRealtime()
  return (
    <div
      className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground"
      title={t("realtime.liveHint")}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", colors[status] ?? colors.offline)}
        />
        {t(`realtime.status.${status}`)}
      </span>
      {lastSeq > 0 ? <span className="font-mono text-[10px]">#{lastSeq}</span> : null}
    </div>
  )
}
