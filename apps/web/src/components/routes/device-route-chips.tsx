import { useTranslation } from "react-i18next"

import type { ListDeviceRoutes200Item } from "@/api/generated/model"
import { Chip } from "@/components/ui/chip"

/**
 * Route-derived chips for a device row.
 *
 * Kept in its own file because route proposal semantics are being extended
 * separately (device-declared routes, exit-node badge): this component only
 * reads the route state the API already returns.
 */
export function DeviceRouteChips({
  routes,
}: {
  routes: ListDeviceRoutes200Item[]
}) {
  const { t } = useTranslation()
  const approved = routes.filter((route) => route.state === "approved")
  const hasSubnet = approved.some((route) => route.kind === "subnet")
  const hasExitNode = approved.some((route) => route.kind === "exit_node")
  const proposedExit =
    !hasExitNode &&
    routes.some(
      (route) =>
        route.kind === "exit_node" &&
        route.state !== "rejected" &&
        route.source === "device_declared"
    )

  if (!hasSubnet && !hasExitNode && !proposedExit) return null

  return (
    <>
      {hasSubnet ? <Chip>{t("routes.subnet")}</Chip> : null}
      {hasExitNode ? <Chip variant="brand">{t("devices.exitNode.approved")}</Chip> : null}
      {proposedExit ? <Chip variant="warn">{t("devices.exitNode.proposed")}</Chip> : null}
    </>
  )
}
