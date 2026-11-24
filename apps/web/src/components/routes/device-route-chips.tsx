import { GlobeIcon, NetworkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ListDeviceRoutes200Item } from "@/api/generated/model"
import { IconBadge } from "@/components/shared/icon-badge"

/**
 * Route-derived marks for a device row: icon-only, with the subnets listed in
 * the tooltip so the row never wraps.
 */
export function DeviceRouteChips({
  routes,
}: {
  routes: ListDeviceRoutes200Item[]
}) {
  const { t } = useTranslation()
  const approved = routes.filter((route) => route.state === "approved")
  const subnets = approved
    .filter((route) => route.kind === "subnet")
    .map((route) => route.cidr)
  const hasExitNode = approved.some((route) => route.kind === "exit_node")
  const proposedExit =
    !hasExitNode &&
    routes.some(
      (route) =>
        route.kind === "exit_node" &&
        route.state !== "rejected" &&
        route.source === "device_declared"
    )

  if (subnets.length === 0 && !hasExitNode && !proposedExit) return null

  return (
    <>
      {subnets.length > 0 ? (
        <IconBadge
          icon={<NetworkIcon aria-hidden="true" className="size-3.5" />}
          label={t("routes.subnet")}
          lines={subnets}
        />
      ) : null}
      {hasExitNode ? (
        <IconBadge
          icon={<GlobeIcon aria-hidden="true" className="size-3.5" />}
          label={t("devices.exitNode.approved")}
          variant="brand"
        />
      ) : null}
      {proposedExit ? (
        <IconBadge
          icon={<GlobeIcon aria-hidden="true" className="size-3.5" />}
          label={t("devices.exitNode.proposed")}
          variant="warn"
        />
      ) : null}
    </>
  )
}
