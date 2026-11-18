import { useTranslation } from "react-i18next"
import { CheckIcon, RouteIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getListDeviceRoutesQueryKey,
  getListDevicesQueryKey,
  getListNetworkRoutesQueryKey,
  useDecideDeviceRoute,
} from "@/api/generated/easyplane"
import type { ListNetworkRoutes200RoutesItem } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { formatDateTime, formatRelativeTime } from "@/lib/format"

/**
 * One pending route request inside the approvals panel. Approving or rejecting
 * is inverted by the Undo action: the decision is terminal, so the honest undo
 * is the opposite decision.
 */
export function PendingRouteApprovalRow({
  route,
  networkId,
}: {
  route: ListNetworkRoutes200RoutesItem
  networkId: string
}) {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()

  const decide = useDecideDeviceRoute({
    mutation: {
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: getListNetworkRoutesQueryKey(networkId),
    })
    await queryClient.invalidateQueries({
      queryKey: getListDeviceRoutesQueryKey(route.deviceId),
    })
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
  }

  const decideWithUndo = (state: "approved" | "rejected") => {
    const inverse = state === "approved" ? "rejected" : "approved"
    decide.mutate(
      { routeId: route.id, data: { state } },
      {
        onSuccess: async () => {
          await invalidate()
          toast.success(
            state === "approved"
              ? t("routes.approvedToast", {
                  cidr:
                    route.kind === "exit_node"
                      ? t("routes.exitNode")
                      : route.cidr,
                })
              : t("routes.rejectedToast"),
            {
              action: {
                label: t("common.undo"),
                onClick: () => {
                  decide.mutate(
                    { routeId: route.id, data: { state: inverse } },
                    { onSuccess: () => void invalidate() }
                  )
                },
              },
            }
          )
        },
      }
    )
  }

  const relative = formatRelativeTime(route.createdAt, i18n.language)
  const isExitNode = route.kind === "exit_node"

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-4 py-3 sm:flex-nowrap sm:px-5">
      <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
        <RouteIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold">{route.deviceHostname}</span>
          <span className="text-fg-3">
            {isExitNode
              ? t("approvals.wantsExitNode")
              : t("approvals.wantsSubnet")}
          </span>
          {!isExitNode ? (
            <Chip className="font-mono text-[11.5px]">{route.cidr}</Chip>
          ) : null}
          {route.source === "device_declared" ? (
            <Chip>{t("routes.declaredByDevice")}</Chip>
          ) : null}
        </div>
        <p
          className="mt-0.5 text-xs text-fg-3"
          title={formatDateTime(route.createdAt, i18n.language)}
        >
          {isExitNode
            ? t("approvals.exitNodeHint", { hostname: route.deviceHostname })
            : t("approvals.subnetHint", { hostname: route.deviceHostname })}
          {relative ? ` · ${relative}` : ""}
        </p>
      </div>
      {isAdmin ? (
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-none">
          <Button
            className="justify-center"
            disabled={decide.isPending}
            onClick={() => decideWithUndo("rejected")}
            variant="outline"
          >
            {t("routes.reject")}
          </Button>
          <Button
            className="justify-center"
            disabled={decide.isPending}
            onClick={() => decideWithUndo("approved")}
          >
            <CheckIcon className="size-4" />
            {t("common.approve")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
