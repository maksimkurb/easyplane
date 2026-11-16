import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import {
  BanIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  ShieldBanIcon,
  TagIcon,
  TrashIcon,
  RadioTowerIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListDeviceRoutesQueryKey,
  getListDevicesQueryKey,
  useBlockDevice,
  useDeleteDevice,
  usePushDeviceConfig,
  useRevokeDeviceCredential,
  useUpdateDeviceHub,
  useListUsers,
} from "@/api/generated/easyplane"
import type { ListDevices200Item, ListDeviceRoutes200Item } from "@/api/generated/model"
import { AnchorRemovalDialog } from "@/components/anchor-removal-dialog"
import { DeviceRouteChips } from "@/components/routes/device-route-chips"
import { useAuth } from "@/auth/auth-context"
import { Chip, Dot } from "@/components/ui/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DeviceIcon } from "@/components/device/device-icon"
import { DeviceRenameDialog } from "@/components/device/device-rename-dialog"
import { DeviceTagsDialog } from "@/components/device/device-tags-dialog"
import { deviceName, osLabel } from "@/lib/device-presentation"
import { formatRelativeTime } from "@/lib/format"

/**
 * One line in the devices list. The row menu carries every per-device action
 * that used to live in the wide actions column: push, rename, tags, hub,
 * revoke, block and remove. Dialogs are local, so the list page stays small.
 */
export function DeviceRow({
  device,
  routes,
  networkId,
  credentialsMode,
  useRendezvous,
}: {
  device: ListDevices200Item
  routes: ListDeviceRoutes200Item[]
  networkId: string
  credentialsMode: boolean
  useRendezvous: boolean
}) {
  const { t, i18n } = useTranslation()
  const { canManage, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [anchorOperation, setAnchorOperation] = useState<"block" | "delete" | null>(null)

  const name = deviceName(device)
  const online = device.online === "online"
  const [now, setNow] = useState(0)
  useEffect(() => {
    // The "New" chip is cosmetic; resolve it after mount so the render path
    // stays pure.
    const timer = window.setTimeout(() => setNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [])
  const newDevice =
    now > 0 &&
    device.approvedAt !== null &&
    now - Date.parse(device.approvedAt) < 86_400_000
  const lastSeen = online ? t("devices.connected") : formatRelativeTime(device.lastSeenAt, i18n.language) ?? t("common.none")
  const users = useListUsers({
    query: { enabled: isAdmin && Boolean(device.ownerUserId) },
  })
  const owner = users.data?.data.find((user) => user.id === device.ownerUserId)

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(device.id) })
    await queryClient.invalidateQueries({ queryKey: getListDeviceRoutesQueryKey(device.id) })
    await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(networkId) })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const push = usePushDeviceConfig({
    mutation: { onSuccess: () => toast.success(t("devices.pushRequested")), onError },
  })
  const updateHub = useUpdateDeviceHub({
    mutation: {
      onSuccess: async (_response, variables) => {
        toast.success(
          variables.data.isHub
            ? t("devices.detail.hub.enabled")
            : t("devices.detail.hub.disabled")
        )
        await invalidate()
      },
      onError,
    },
  })
  const block = useBlockDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.blocked"))
        await invalidate()
      },
      onError,
    },
  })
  const remove = useDeleteDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.deleted"))
        await invalidate()
      },
      onError,
    },
  })
  const revoke = useRevokeDeviceCredential({
    mutation: {
      onSuccess: async () => {
        toast.success(t("access.revoked"))
        await invalidate()
      },
      onError,
    },
  })

  const askRemoval = (operation: "block" | "delete") => {
    if (credentialsMode && device.effectiveRole === "anchor") {
      setAnchorOperation(operation)
      return
    }
    const question =
      operation === "block" ? t("devices.blockConfirm") : t("devices.deleteConfirm")
    if (!window.confirm(question)) return
    if (operation === "block") block.mutate({ deviceId: device.id, data: {} })
    else remove.mutate({ deviceId: device.id, data: {} })
  }

  return (
    <div className="relative grid min-h-16 grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-x-2 gap-y-2 px-4 py-2.5 transition-colors hover:bg-surface-2/70 md:gap-x-4 md:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(120px,1fr)_minmax(130px,1fr)_minmax(130px,1fr)_40px]">
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
          <DeviceIcon className="size-4" os={device.os} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              aria-label={t("devices.openDevice", { name })}
              className="truncate font-semibold after:absolute after:inset-0 after:z-0 hover:underline focus-visible:underline"
              href={`/devices/${device.id}`}
            >
              {name}
            </Link>
            <span className="relative z-[1] flex min-w-0 flex-wrap items-center gap-1.5">
              {device.isHub ? (
                <Chip variant="brand">{t("devices.detail.hub.badge")}</Chip>
              ) : null}
              <DeviceRouteChips routes={routes} />
              {device.state === "blocked" ? (
                <Chip variant="err">{t("devices.status.blocked")}</Chip>
              ) : null}
              {device.sync === "stale" && !device.lastPushError ? (
                <Chip variant="warn">{t("devices.chips.configNotApplied")}</Chip>
              ) : null}
              {device.sync === "error" || device.lastPushError ? (
                <Chip variant="err">{t("devices.chips.pushFailed")}</Chip>
              ) : null}
              {newDevice && device.state === "approved" ? (
                <Chip variant="ok">{t("devices.chips.new")}</Chip>
              ) : null}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-3">
            <span className="font-mono text-[12px] whitespace-nowrap lg:hidden">
              {device.virtualIpv4 ?? t("common.none")}
            </span>
            {device.tags.length > 0
              ? device.tags.map((tag) => (
                  <Chip key={tag} variant="tag">
                    {tag}
                  </Chip>
                ))
              : device.ownerUserId
                ? <span className="truncate">{t("devices.ownedBy", {
                    owner: owner?.displayName || owner?.email || device.ownerUserId.slice(0, 8),
                  })}</span>
                : <span className="truncate">{osLabel(device.os)}</span>}
          </div>
        </div>
      </div>

      <span className="hidden truncate font-mono text-xs text-fg-2 lg:block">
        {device.virtualIpv4 ?? t("common.none")}
      </span>

      <div className="hidden min-w-0 lg:block">
        <div className="truncate text-[13px]">{osLabel(device.os)}</div>
        <div className="truncate text-xs text-fg-3">
          {device.easytierVersion ? `EasyTier ${device.easytierVersion}` : t("common.none")}
        </div>
      </div>

      <span className="flex items-center gap-2 justify-self-end text-[13px] whitespace-nowrap text-fg-2 lg:justify-self-auto">
        <Dot online={online} />
        <span className="max-sm:hidden">{lastSeen}</span>
      </span>

      <div className="relative z-10 flex justify-end">
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label={t("devices.actionsFor", { name })}
                  className="grid size-9 cursor-pointer place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  type="button"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {device.state === "approved" ? (
                <DropdownMenuItem
                  disabled={push.isPending}
                  onClick={() => push.mutate({ deviceId: device.id })}
                >
                  <RefreshCwIcon />
                  {t("devices.menu.push")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() => setRenameOpen(true)}
              >
                <PencilIcon />
                {t("devices.menu.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTagsOpen(true)}
              >
                <TagIcon />
                {t("devices.menu.tags")}
              </DropdownMenuItem>
              {isAdmin ? (
                <DropdownMenuItem
                  disabled={updateHub.isPending}
                  onClick={() =>
                    updateHub.mutate({
                      deviceId: device.id,
                      data: { isHub: !device.isHub },
                    })
                  }
                >
                  <RadioTowerIcon />
                  <span className="flex-1">{t("devices.detail.hub.title")}</span>
                  {device.isHub ? <CheckIcon className="text-brand-text" /> : null}
                </DropdownMenuItem>
              ) : null}
              {credentialsMode && device.effectiveRole === "member" && device.credential ? (
                <DropdownMenuItem
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (window.confirm(t("access.revokeConfirm", { hostname: name }))) {
                      revoke.mutate({ deviceId: device.id })
                    }
                  }}
                >
                  <ShieldBanIcon />
                  {t("access.revoke")}
                </DropdownMenuItem>
              ) : null}
              <div aria-hidden="true" className="my-1.5 -mx-1.5 h-px bg-line" />
              {device.state !== "blocked" ? (
                <DropdownMenuItem
                  disabled={block.isPending}
                  onClick={() => askRemoval("block")}
                >
                  <BanIcon />
                  {t("common.block")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                destructive
                disabled={remove.isPending}
                onClick={() => askRemoval("delete")}
              >
                <TrashIcon />
                {t("devices.menu.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <DeviceRenameDialog
        currentName={device.dnsName ?? name}
        deviceId={device.id}
        networkId={device.networkId}
        onOpenChange={setRenameOpen}
        open={renameOpen}
        zone={device.magicDnsZone}
      />

      <DeviceTagsDialog
        currentTags={device.tags}
        deviceId={device.id}
        deviceName={name}
        onOpenChange={setTagsOpen}
        open={tagsOpen}
      />

      <AnchorRemovalDialog
        hostname={name}
        networkId={networkId}
        onClose={() => setAnchorOperation(null)}
        onConfirm={() => {
          if (!anchorOperation) return
          if (anchorOperation === "block") {
            block.mutate({
              deviceId: device.id,
              data: { acknowledgeAnchorRisk: true },
            })
          } else {
            remove.mutate({
              deviceId: device.id,
              data: { acknowledgeAnchorRisk: true },
            })
          }
          setAnchorOperation(null)
        }}
        open={anchorOperation !== null}
        operation={anchorOperation ?? "block"}
        pending={block.isPending || remove.isPending}
        useRendezvous={useRendezvous}
      />
    </div>
  )
}
