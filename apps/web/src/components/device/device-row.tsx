import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import {
  BanIcon,
  CheckIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  ShieldBanIcon,
  TagIcon,
  TrashIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListDeviceRoutesQueryKey,
  getListDevicesQueryKey,
  getListNetworksQueryKey,
  useApproveDevice,
  useBlockDevice,
  useDeleteDevice,
  usePushDeviceConfig,
  useRevokeDeviceCredential,
  useUpdateDeviceHub,
  useListUsers,
} from "@/api/generated/easyplane"
import type {
  ListDevices200Item,
  ListDeviceRoutes200Item,
} from "@/api/generated/model"
import { AnchorRemovalDialog } from "@/components/anchor-removal-dialog"
import { DeviceRouteChips } from "@/components/routes/device-route-chips"
import { useAuth } from "@/auth/auth-context"
import { Chip } from "@/components/ui/chip"
import { IconBadge } from "@/components/shared/icon-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/device/confirm-dialog"
import { DeviceIcon } from "@/components/device/device-icon"
import { DeviceDescriptionSummary } from "@/components/device/device-description"
import { DeviceRenameDialog } from "@/components/device/device-rename-dialog"
import { DeviceStatusCell } from "@/components/device/device-status-cell"
import { DeviceTagsDialog } from "@/components/device/device-tags-dialog"
import { deriveDeviceStatus, tagLabel } from "@/lib/device-status"
import { deviceName, osLabel } from "@/lib/device-presentation"

/**
 * The one device row used by the global list, the network list and the device
 * page's siblings. It carries every per-device action in its menu and shows a
 * single status column (see lib/device-status), so a device never looks online
 * and stale at the same time.
 *
 * Pass `networkName` to show which network the device belongs to (the global
 * list does; a network's own list already knows).
 */
export function DeviceRow({
  device,
  routes = [],
  networkId,
  credentialsMode = false,
  useRendezvous = false,
  networkName,
}: {
  device: ListDevices200Item
  routes?: ListDeviceRoutes200Item[]
  networkId: string
  credentialsMode?: boolean
  useRendezvous?: boolean
  /** Secondary text with the network name; omitted inside a network. */
  networkName?: string
}) {
  const { t } = useTranslation()
  const { canManage, isAdmin, me } = useAuth()
  const queryClient = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [anchorOperation, setAnchorOperation] = useState<
    "block" | "delete" | null
  >(null)
  const [confirmOperation, setConfirmOperation] = useState<
    "block" | "delete" | null
  >(null)

  const name = deviceName(device)
  const status = deriveDeviceStatus(device)
  const os = osLabel(device.os)
  const secondaryHostname =
    device.hostname && device.hostname !== name ? device.hostname : null
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

  // The owner is a person's name, never a raw ID. While the user list loads
  // the row shows a placeholder instead of the first eight UUID characters.
  const users = useListUsers({
    query: { enabled: isAdmin && Boolean(device.ownerUserId) },
  })
  const owner = users.data?.data.find((user) => user.id === device.ownerUserId)
  const ownerPending =
    Boolean(device.ownerUserId) && (users.isLoading || users.isPending)

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({ queryKey: getListNetworksQueryKey() })
    await queryClient.invalidateQueries({
      queryKey: getGetDeviceQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getListDeviceRoutesQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getGetNetworkQueryKey(networkId),
    })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const push = usePushDeviceConfig({
    mutation: {
      onSuccess: () => toast.success(t("devices.pushRequested")),
      onError,
    },
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
  const approve = useApproveDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.approved"))
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
    setConfirmOperation(operation)
  }

  const confirmRemoval = () => {
    if (!confirmOperation) return
    if (confirmOperation === "block")
      block.mutate({ deviceId: device.id, data: {} })
    else remove.mutate({ deviceId: device.id, data: {} })
    setConfirmOperation(null)
  }

  const hubChip = device.isHub ? (
    <IconBadge
      icon={<RadioTowerIcon aria-hidden="true" className="size-3.5" />}
      label={t("devices.detail.hub.badge")}
    />
  ) : null

  return (
    <div className="relative grid min-h-16 grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-x-2 gap-y-2 px-4 py-2.5 transition-colors hover:bg-surface-2/70 md:gap-x-4 md:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_44px]">
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
          <DeviceIcon
            className="size-4"
            hostname={device.hostname}
            os={device.os}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              aria-label={t("devices.openDevice", { name })}
              className="inline-flex min-h-11 max-w-full min-w-0 items-center truncate font-semibold after:absolute after:inset-0 after:z-0 hover:underline focus-visible:underline sm:min-h-0"
              href={`/devices/${device.id}`}
              title={name}
            >
              <span className="truncate">{name}</span>
            </Link>
            <span className="relative z-[1] flex min-w-0 items-center gap-1.5">
              {hubChip}
              <DeviceRouteChips routes={routes} />
            </span>
            {newDevice && device.state === "approved" ? (
              <Chip variant="ok">{t("devices.chips.new")}</Chip>
            ) : null}
          </div>
          <DeviceDescriptionSummary
            className="mt-0.5"
            description={device.description}
          />
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
            {secondaryHostname ? (
              <span
                className="hidden max-w-full truncate font-mono text-xs lg:inline"
                title={secondaryHostname}
              >
                {secondaryHostname}
              </span>
            ) : null}
            <span className="font-mono text-xs whitespace-nowrap lg:hidden">
              {device.virtualIpv4 ?? t("common.none")}
            </span>
            {networkName ? (
              <Link
                className="relative z-[1] inline-flex min-h-11 max-w-full min-w-0 items-center truncate hover:text-foreground hover:underline sm:min-h-0"
                href={`/networks/${device.networkId}`}
                title={networkName}
              >
                {networkName}
              </Link>
            ) : null}
            {ownerPending ? (
              <Skeleton className="h-3 w-20" />
            ) : owner && owner.id !== me?.user.id ? (
              <span className="max-w-full truncate">
                {t("deviceStatus.ownedBy", {
                  owner: owner.displayName || owner.email,
                })}
              </span>
            ) : null}
            {device.tags.length > 0 ? (
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {device.tags.map((tag) => (
                  <Chip
                    className="text-xs"
                    key={tag}
                    title={tagLabel(tag)}
                    variant="tag"
                  >
                    <TagIcon aria-hidden="true" className="size-3" />
                    {tagLabel(tag)}
                  </Chip>
                ))}
              </span>
            ) : null}
            <span
              className="max-w-full truncate text-xs text-fg-3 lg:hidden"
              title={os}
            >
              {os}
            </span>
          </div>
        </div>
      </div>

      <span className="hidden truncate font-mono text-xs text-fg-2 lg:block">
        {device.virtualIpv4 ?? t("common.none")}
      </span>

      <div className="hidden min-w-0 lg:block">
        <div className="truncate text-[13px]" title={os}>
          {os}
        </div>
        <div
          className="truncate text-xs text-fg-3"
          title={
            device.easytierVersion
              ? `EasyTier ${device.easytierVersion}`
              : t("common.none")
          }
        >
          {device.easytierVersion
            ? `EasyTier ${device.easytierVersion}`
            : t("common.none")}
        </div>
      </div>

      <DeviceStatusCell
        className="justify-self-end whitespace-nowrap lg:justify-self-auto"
        device={device}
      />

      <div className="relative z-10 flex justify-end">
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label={t("devices.actionsFor", { name })}
                  className="grid size-11 cursor-pointer place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none lg:size-9"
                  type="button"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                render={<Link href={`/devices/${device.id}`} />}
              >
                <ExternalLinkIcon />
                {t("devicesGlobal.openDevice")}
              </DropdownMenuItem>
              {device.state === "approved" ? (
                <DropdownMenuItem
                  disabled={push.isPending || !status.connected}
                  onClick={() => push.mutate({ deviceId: device.id })}
                  title={
                    status.connected
                      ? undefined
                      : t("deviceStatus.hint.pushOffline")
                  }
                >
                  <RefreshCwIcon />
                  {t("devices.menu.push")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                <PencilIcon />
                {t("devices.menu.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTagsOpen(true)}>
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
                  <span className="flex-1">
                    {t("devices.detail.hub.title")}
                  </span>
                  {device.isHub ? (
                    <CheckIcon className="text-brand-text" />
                  ) : null}
                </DropdownMenuItem>
              ) : null}
              {credentialsMode &&
              device.effectiveRole === "member" &&
              device.credential ? (
                <DropdownMenuItem
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        t("access.revokeConfirm", { hostname: name })
                      )
                    ) {
                      revoke.mutate({ deviceId: device.id })
                    }
                  }}
                >
                  <ShieldBanIcon />
                  {t("access.revoke")}
                </DropdownMenuItem>
              ) : null}
              <div aria-hidden="true" className="-mx-1.5 my-1.5 h-px bg-line" />
              {device.state === "blocked" ? (
                <DropdownMenuItem
                  disabled={approve.isPending}
                  onClick={() =>
                    approve.mutate({ deviceId: device.id, data: {} })
                  }
                >
                  <CheckIcon />
                  {t("common.unblock")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={block.isPending}
                  onClick={() => askRemoval("block")}
                >
                  <BanIcon />
                  {t("common.block")}
                </DropdownMenuItem>
              )}
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

      <ConfirmDialog
        confirmLabel={
          confirmOperation === "block" ? t("common.block") : t("common.remove")
        }
        description={
          confirmOperation === "block"
            ? t("devices.blockConfirm")
            : t("devices.deleteConfirm")
        }
        destructive={confirmOperation === "delete"}
        onConfirm={confirmRemoval}
        onOpenChange={(open) => {
          if (!open) setConfirmOperation(null)
        }}
        open={confirmOperation !== null}
        pending={block.isPending || remove.isPending}
        title={
          confirmOperation === "block"
            ? t("deviceStatus.danger.blockTitle")
            : t("deviceStatus.danger.deleteTitle")
        }
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
