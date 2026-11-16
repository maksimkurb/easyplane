import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"

export type ExitNodeState = "none" | "proposed" | "approved"

/**
 * Exit-node badge for devices that advertise the flag in their own config.
 * `proposed` means the device advertises it and an admin has not decided yet;
 * `approved` means the admin approved it. Approval is consent only: actual
 * egress needs the client's OS route and `exit_nodes` (docs/POLICY.md §7.1).
 */
export function ExitNodeBadge({
  state,
  className,
}: {
  state: ExitNodeState
  className?: string
}) {
  const { t } = useTranslation()
  if (state === "none") return null
  const tone =
    state === "approved"
      ? "border-violet-500/40 text-violet-700 dark:text-violet-300"
      : "border-amber-500/40 text-amber-700 dark:text-amber-300"
  return (
    <Badge className={`${tone} ${className ?? ""}`} title={t("devices.exitNode.hint")} variant="outline">
      {t(`devices.exitNode.${state}`)}
    </Badge>
  )
}
