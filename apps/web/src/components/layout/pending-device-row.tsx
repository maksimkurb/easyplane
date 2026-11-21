import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { CheckIcon, NetworkIcon, XIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetNetworkQueryKey,
  getListDevicesQueryKey,
  getListNetworksQueryKey,
  useApproveDevice,
  useBlockDevice,
} from "@/api/generated/easyplane"
import type { ListDevices200Item } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { DeviceIcon } from "@/components/device/device-icon"
import { RelativeTime } from "@/components/shared/relative-time"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { deviceName, osLabel } from "@/lib/device-presentation"

/**
 * A pending device, in the same visual language as `DeviceRow` but with the
 * two actions a newcomer actually needs: approve or reject. It is used by both
 * `/devices` (an unexpected pending row still gets a decision) and `/pending`.
 */
export function PendingDeviceRow({
  device,
  networkName,
}: {
  device: ListDevices200Item
  networkName: string
}) {
  const { t } = useTranslation()
  const { canManage } = useAuth()
  const queryClient = useQueryClient()
  const name = deviceName(device)
  const hostname = device.hostname

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
    await queryClient.invalidateQueries({
      queryKey: getGetNetworkQueryKey(device.networkId),
    })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const approve = useApproveDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.approvedToast", { hostname: name }))
        await invalidate()
      },
      onError,
    },
  })
  const reject = useBlockDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.rejectedToast", { hostname: name }))
        await invalidate()
      },
      onError,
    },
  })

  const pending = approve.isPending || reject.isPending

  return (
    <div className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-surface-2/70 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4 md:px-5">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
          <DeviceIcon className="size-4" os={device.os} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              aria-label={t("devices.openDevice", { name })}
              className="truncate font-semibold hover:underline"
              href={`/devices/${device.id}`}
            >
              {name}
            </Link>
            <Chip variant="warn">{t("devices.status.pending")}</Chip>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-3">
            {hostname && hostname !== name ? (
              <span className="truncate font-mono text-xs">
                {hostname}
              </span>
            ) : null}
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <NetworkIcon aria-hidden="true" className="size-3.5 flex-none" />
              <Link
                className="truncate hover:text-foreground hover:underline"
                href={`/networks/${device.networkId}`}
              >
                {networkName}
              </Link>
            </span>
            <span className="truncate">{osLabel(device.os)}</span>
          </div>
          <p className="mt-1 text-xs text-fg-3">
            {t("approvals.wantsToJoin")} ·{" "}
            <RelativeTime value={device.createdAt} />
          </p>
        </div>
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2 max-md:pl-[50px]">
          <Button
            aria-label={t("devicesGlobal.rejectDevice", { name })}
            className="flex-1 sm:flex-none"
            disabled={pending}
            onClick={() =>
              reject.mutate({
                deviceId: device.id,
                data: {
                  acknowledgeAnchorRisk: device.effectiveRole === "anchor",
                },
              })
            }
            size="sm"
            variant="outline"
          >
            <XIcon className="size-4" />
            {t("devicesGlobal.reject")}
          </Button>
          <Button
            aria-label={t("devicesGlobal.approveDevice", { name })}
            className="flex-1 sm:flex-none"
            disabled={pending}
            onClick={() => approve.mutate({ deviceId: device.id, data: {} })}
            size="sm"
          >
            <CheckIcon className="size-4" />
            {t("devicesGlobal.approve")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
