import { ShieldIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

/**
 * WireGuard portal clients are a separate kind of member: they are not
 * EasyTier devices, so they carry an explicit chip everywhere a device would
 * otherwise be assumed. Kept in its own file so the shared device icon/row
 * components only need a one-line touch.
 */
export function WireguardIcon({ className }: { className?: string }) {
  return <ShieldIcon aria-hidden="true" className={className} />
}

export function WireguardBadge({
  className,
  compact = false,
}: {
  className?: string
  /** Icon-only variant for dense rows; the label stays available to AT via `title`. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const label = t("wireguard.badge")
  return (
    <span
      className={cn(
        "inline-flex h-[22px] flex-none items-center gap-1 rounded-md bg-surface-2 px-2 text-xs leading-4 font-medium whitespace-nowrap text-fg-2 ring-1 ring-line",
        className
      )}
      title={label}
    >
      <WireguardIcon className="size-3" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  )
}
