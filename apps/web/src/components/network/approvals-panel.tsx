import { useTranslation } from "react-i18next"
import { AlertTriangleIcon, CheckIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  getListInvitesQueryKey,
  getListNetworkRoutesQueryKey,
  useApproveDevice,
  useBlockDevice,
} from "@/api/generated/easyplane"
import type {
  ListDevices200Item,
  ListInvites200Item,
  ListNetworkRoutes200RoutesItem,
} from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { PendingRouteApprovalRow } from "@/components/routes/pending-route-approvals"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { DeviceIcon } from "@/components/device/device-icon"
import { osLabel } from "@/lib/device-presentation"
import { formatRelativeTime } from "@/lib/format"

/**
 * The "Needs your approval" block. Pending devices and pending route requests
 * are the only things that block the mesh, so they live above the device list
 * instead of in a separate page. Approving or rejecting is reversible from the
 * toast; the undo applies the opposite decision.
 */
export function ApprovalsPanel({
  networkId,
  devices,
  routes,
  invites,
}: {
  networkId: string
  devices: ListDevices200Item[]
  routes: ListNetworkRoutes200RoutesItem[]
  invites: ListInvites200Item[]
}) {
  const { t, i18n } = useTranslation()
  const { canManage } = useAuth()
  const queryClient = useQueryClient()

  const pendingDevices = devices.filter((device) => device.state === "pending")
  const pendingRoutes = routes.filter((route) => route.state === "pending")
  const count = pendingDevices.length + pendingRoutes.length

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({ queryKey: getListNetworkRoutesQueryKey(networkId) })
    await queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey(networkId) })
    await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(networkId) })
  }

  const approve = useApproveDevice({
    mutation: {
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const block = useBlockDevice({
    mutation: {
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  if (count === 0) return null

  const inviteLabel = (inviteId: string | null) =>
    invites.find((invite) => invite.id === inviteId)?.label || null

  const approveWithUndo = (device: ListDevices200Item) => {
    approve.mutate(
      { deviceId: device.id, data: {} },
      {
        onSuccess: async () => {
          await invalidate()
          toast.success(t("devices.approvedToast", { hostname: hostnameOf(device) }), {
            action: {
              label: t("common.undo"),
              onClick: () => {
                block.mutate(
                  {
                    deviceId: device.id,
                    data: { acknowledgeAnchorRisk: device.effectiveRole === "anchor" },
                  },
                  { onSuccess: () => void invalidate() }
                )
              },
            },
          })
        },
      }
    )
  }

  const rejectWithUndo = (device: ListDevices200Item) => {
    block.mutate(
      {
        deviceId: device.id,
        data: { acknowledgeAnchorRisk: device.effectiveRole === "anchor" },
      },
      {
        onSuccess: async () => {
          await invalidate()
          toast.success(t("devices.rejectedToast", { hostname: hostnameOf(device) }), {
            action: {
              label: t("common.undo"),
              onClick: () => {
                approve.mutate(
                  { deviceId: device.id, data: {} },
                  { onSuccess: () => void invalidate() }
                )
              },
            },
          })
        },
      }
    )
  }

  return (
    <section
      aria-label={t("approvals.title")}
      className="mb-5 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-warn-line"
    >
      <div className="flex h-12 items-center gap-2.5 border-b border-warn-line bg-warn-soft px-4 font-semibold text-warn sm:px-5">
        <AlertTriangleIcon aria-hidden="true" className="size-4" />
        <span className="min-w-0 flex-1 truncate">{t("approvals.title")}</span>
        <Chip variant="warn">{count}</Chip>
      </div>

      {pendingDevices.map((device) => {
            const relative = formatRelativeTime(device.createdAt, i18n.language)
            const invite = inviteLabel(device.inviteId)
            return (
              <div
                className="flex flex-wrap items-center gap-x-3.5 gap-y-3 border-t border-line px-4 py-3 first:border-t-0 sm:flex-nowrap sm:px-5"
                key={device.id}
              >
                <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
                  <DeviceIcon className="size-4" os={device.os} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{hostnameOf(device)}</span>
                    <span className="text-fg-3">{t("approvals.wantsToJoin")}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-3">
                    {osLabel(device.os)}
                    {invite ? ` · ${t("approvals.invite", { label: invite })}` : ""}
                    {relative ? ` · ${relative}` : ""}
                  </p>
                </div>
                {canManage ? (
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-none">
                    <Button
                      className="justify-center"
                      disabled={block.isPending}
                      onClick={() => rejectWithUndo(device)}
                      variant="outline"
                    >
                      {t("approvals.reject")}
                    </Button>
                    <Button
                      className="justify-center"
                      disabled={approve.isPending}
                      onClick={() => approveWithUndo(device)}
                    >
                      <CheckIcon className="size-4" />
                      {t("common.approve")}
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}

      {pendingRoutes.map((route) => (
        <div className="border-t border-line first:border-t-0" key={route.id}>
          <PendingRouteApprovalRow networkId={networkId} route={route} />
        </div>
      ))}
    </section>
  )
}

function hostnameOf(device: ListDevices200Item): string {
  return device.dnsName || device.hostname || device.machineId.slice(0, 8)
}
