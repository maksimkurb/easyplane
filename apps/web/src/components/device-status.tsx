import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ListDevices200Item } from "@/api/generated/model"

type State = ListDevices200Item["state"]
type Online = ListDevices200Item["online"]
type Sync = ListDevices200Item["sync"]

const stateClass: Record<State, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blocked: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
}

const syncClass: Record<Sync, string> = {
  "in-sync": "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  stale: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  "not-applicable": "text-muted-foreground",
}

export function DeviceStatusBadges({
  state,
  online,
  sync,
}: {
  state: State
  online: Online
  sync: Sync
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge className={cn("border", stateClass[state])} variant="outline">
        {t(`devices.status.${state}`)}
      </Badge>
      <Badge className="gap-1.5" variant="outline">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            online === "online" ? "bg-emerald-500" : "bg-muted-foreground/50"
          )}
        />
        {t(`devices.status.${online}`)}
      </Badge>
      <Badge className={cn("border", syncClass[sync])} variant="outline">
        {t(`devices.status.${sync === "not-applicable" ? "notApplicable" : sync === "in-sync" ? "inSync" : sync}`)}
      </Badge>
    </div>
  )
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
