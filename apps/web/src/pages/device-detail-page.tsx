import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation, useParams } from "wouter"
import {
  AlertTriangleIcon,
  BanIcon,
  ChevronRightIcon,
  ClockIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
  WifiOffIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  getGetDeviceQueryKey,
  getGetNetworkQueryKey,
  getListDeviceRevisionsQueryKey,
  getListDeviceRoutesQueryKey,
  getListDevicesQueryKey,
  getListNetworkRoutesQueryKey,
  useApproveDevice,
  useBlockDevice,
  useDeleteDevice,
  useGetDevice,
  useGetNetwork,
  useGetNetworkTopology,
  useListDeviceRevisions,
  useListDeviceRoutes,
  usePushDeviceConfig,
} from "@/api/generated/easyplane"
import { AnchorRemovalDialog } from "@/components/anchor-removal-dialog"
import { useAuth } from "@/auth/auth-context"
import { ExitNodeBadge } from "@/components/exit-node-badge"
import { PageContainer } from "@/components/layout/page-container"
import { ConfirmDialog } from "@/components/device/confirm-dialog"
import { DeviceAccessCard } from "@/components/device-access-card"
import { DeviceConnectionsCard } from "@/components/device/device-connections-card"
import { DeviceDetailsCard } from "@/components/device/device-details-card"
import { DeviceHistoryCard } from "@/components/device/device-history-card"
import { DeviceIcon } from "@/components/device/device-icon"
import { DeviceHubCard } from "@/components/device/device-hub-card"
import { DeviceRenameDialog } from "@/components/device/device-rename-dialog"
import { DeviceStatusCell } from "@/components/device/device-status-cell"
import { DeviceTagsDialog } from "@/components/device/device-tags-dialog"
import { RouteLoadError } from "@/components/routes/route-load-error"
import { DeviceRoutesCard } from "@/components/routes/device-routes-card"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyInline } from "@/components/shared/copy-inline"
import {
  deviceDisplayName,
  deviceSecondaryHostname,
  deriveDeviceStatus,
  type DeviceStatus,
} from "@/lib/device-status"
import { osLabel } from "@/lib/device-presentation"
import { formatRelativeTime } from "@/lib/format"
import { retryableQuery } from "@/lib/query-retry"

export function DeviceDetailPage() {
  const { t } = useTranslation()
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [, navigate] = useLocation()
  const { canManage } = useAuth()
  const [renameOpen, setRenameOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [anchorOperation, setAnchorOperation] = useState<
    "block" | "delete" | null
  >(null)
  const [confirmOperation, setConfirmOperation] = useState<
    "block" | "delete" | null
  >(null)

  const deviceQuery = useGetDevice(id)
  const revisionsQuery = useListDeviceRevisions(id, { query: retryableQuery })
  const routesQuery = useListDeviceRoutes(id, { query: retryableQuery })
  const device = deviceQuery.data?.data
  const networkQuery = useGetNetwork(device?.networkId ?? "", {
    query: { enabled: Boolean(device?.networkId) },
  })
  const topologyQuery = useGetNetworkTopology(
    device?.networkId ?? "",
    undefined,
    {
      query: { enabled: Boolean(device?.networkId) },
    }
  )

  const revisions = revisionsQuery.data?.data ?? []
  const routes = routesQuery.data?.data ?? []
  const network = networkQuery.data?.data
  const topology = topologyQuery.data?.data
  const topologyNode =
    topology?.nodes.find((node) => node.deviceId === device?.id) ?? null
  const publicIp = topologyNode?.publicIps[0] ?? null

  const refresh = async () => {
    if (!device) return
    await queryClient.invalidateQueries({
      queryKey: getGetDeviceQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getListDeviceRevisionsQueryKey(device.id),
    })
    await queryClient.invalidateQueries({
      queryKey: getListDeviceRoutesQueryKey(device.id),
    })
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({
      queryKey: getListNetworkRoutesQueryKey(device.networkId),
    })
    await queryClient.invalidateQueries({
      queryKey: getGetNetworkQueryKey(device.networkId),
    })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const push = usePushDeviceConfig({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.pushRequested"))
        await refresh()
      },
      onError,
    },
  })
  const block = useBlockDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.blocked"))
        await refresh()
      },
      onError,
    },
  })
  const approve = useApproveDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.approved"))
        await refresh()
      },
      onError,
    },
  })
  const remove = useDeleteDevice({
    mutation: {
      onSuccess: async () => {
        toast.success(t("devices.deleted"))
        await queryClient.invalidateQueries({
          queryKey: getListDevicesQueryKey(),
        })
        if (device) navigate(`/networks/${device.networkId}`)
      },
      onError,
    },
  })

  if (deviceQuery.isLoading) {
    return (
      <PageContainer className="py-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="mt-5 h-96 w-full rounded-xl" />
      </PageContainer>
    )
  }
  if (!device) {
    return (
      <PageContainer className="py-10">
        <p className="text-sm text-fg-3">{t("common.notFound")}</p>
      </PageContainer>
    )
  }

  const name = deviceDisplayName(device)
  const secondaryHostname = deviceSecondaryHostname(device)
  const status = deriveDeviceStatus(device)
  const blocked = status.kind === "blocked"
  const credentialsMode = device.accessMode === "credentials"

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

  return (
    <>
      <section className="border-b border-line bg-card">
        <PageContainer className="py-4 sm:py-5">
          <nav
            aria-label={t("devices.breadcrumbs")}
            className="mb-2 flex min-w-0 items-center gap-1.5 text-[13px] text-fg-3"
          >
            {network ? (
              <Link
                className="inline-flex min-h-11 max-w-full min-w-0 items-center truncate rounded-md hover:text-foreground hover:underline sm:min-h-0"
                href={`/networks/${network.id}`}
                title={network.name}
              >
                {network.name}
              </Link>
            ) : networkQuery.isLoading ? (
              <Skeleton className="h-4 w-28" />
            ) : (
              <Link
                className="inline-flex min-h-11 items-center rounded-md hover:text-foreground hover:underline sm:min-h-0"
                href="/networks"
              >
                {t("networks.title")}
              </Link>
            )}
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 flex-none text-fg-3"
            />
            <span
              aria-current="page"
              className="min-w-0 truncate font-medium text-fg-2"
            >
              {name}
            </span>
          </nav>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:flex-nowrap">
            <span className="grid size-12 flex-none place-items-center rounded-xl bg-surface-2 text-fg-2 ring-1 ring-line">
              <DeviceIcon
                className="size-6"
                hostname={device.hostname}
                os={device.os}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:[&>*:nth-child(n+2)]:hidden">
                <h1
                  className="min-w-0 truncate text-[22px] leading-7 font-semibold tracking-[-0.018em] sm:text-2xl sm:leading-8"
                  id="page-title"
                >
                  {name}
                </h1>
                {device.isHub ? (
                  <Chip>
                    <RadioTowerIcon aria-hidden="true" className="size-3" />
                    {t("devices.detail.hub.badge")}
                  </Chip>
                ) : null}
                <ExitNodeBadge state={device.exitNode} />
                {device.configManagedLocally ? (
                  <Chip variant="warn">{t("devices.localConfig")}</Chip>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-3">
                <DeviceStatusCell device={device} />
                {device.virtualIpv4 ? (
                  <CopyInline
                    className="-ml-1.5"
                    label={t("devices.copyVirtualIp")}
                    value={device.virtualIpv4}
                  />
                ) : null}
                <span className="max-sm:hidden" title={osLabel(device.os)}>
                  {osLabel(device.os)}
                </span>
                {device.easytierVersion ? (
                  <span className="max-sm:hidden">
                    EasyTier {device.easytierVersion}
                  </span>
                ) : null}
                {secondaryHostname ? (
                  <span className="max-sm:hidden">
                    {t("deviceStatus.hostname", {
                      hostname: secondaryHostname,
                    })}
                  </span>
                ) : null}
              </div>
            </div>

            {canManage ? (
              <div className="flex w-full gap-2 sm:w-auto sm:flex-none">
                {status.kind === "pending" ? (
                  <Button
                    className="flex-1 justify-center sm:flex-none"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate({ deviceId: device.id, data: {} })
                    }
                  >
                    <ShieldCheckIcon className="size-4" />
                    {t("common.approve")}
                  </Button>
                ) : null}
                {status.kind === "updating" || status.kind === "push-failed" ? (
                  <Button
                    className="flex-1 justify-center sm:flex-none"
                    disabled={push.isPending}
                    onClick={() => push.mutate({ deviceId: device.id })}
                  >
                    <RefreshCwIcon className="size-4" />
                    {t("common.retry")}
                  </Button>
                ) : null}
                {status.kind === "online" ? (
                  <Button
                    className="flex-1 justify-center sm:flex-none"
                    disabled={push.isPending}
                    onClick={() => push.mutate({ deviceId: device.id })}
                    variant="outline"
                  >
                    <RefreshCwIcon className="size-4" />
                    {t("devices.push")}
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label={t("devices.detail.actions")}
                        className="flex-none"
                        size="icon"
                        variant="outline"
                      />
                    }
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
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
                    <DropdownMenuItem
                      onClick={() =>
                        navigate(`/networks/${device.networkId}/map`)
                      }
                    >
                      {t("network.tabs.map")}
                    </DropdownMenuItem>
                    <div
                      aria-hidden="true"
                      className="-mx-1.5 my-1.5 h-px bg-line"
                    />
                    {blocked ? (
                      <DropdownMenuItem
                        disabled={approve.isPending}
                        onClick={() =>
                          approve.mutate({ deviceId: device.id, data: {} })
                        }
                      >
                        <ShieldCheckIcon />
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
                      {t("common.remove")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </div>
        </PageContainer>
      </section>

      <PageContainer className="py-5">
        <div className="flex flex-col gap-5">
          <DeviceStatusBlock
            applying={push.isPending}
            approving={approve.isPending}
            canManage={canManage}
            device={device}
            onApprove={() => approve.mutate({ deviceId: device.id, data: {} })}
            onRetry={() => push.mutate({ deviceId: device.id })}
            status={status}
          />

          <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
            <div className="order-2 flex min-w-0 flex-1 flex-col gap-5 xl:order-1">
              {routesQuery.isError ? (
                <RouteLoadError
                  onRetry={() => void routesQuery.refetch()}
                  pending={routesQuery.isFetching}
                />
              ) : null}
              <DeviceRoutesCard device={device} routes={routes} />
              <DeviceHubCard device={device} />
              <DeviceHistoryCard device={device} revisions={revisions} />
            </div>

            <aside className="order-1 flex w-full min-w-0 flex-col gap-5 xl:order-2 xl:w-[340px] xl:flex-none">
              <DeviceDetailsCard device={device} publicIp={publicIp} />
              <DeviceAccessCard device={device} />
              <DeviceConnectionsCard
                deviceId={device.id}
                links={topology?.links ?? []}
                loading={topologyQuery.isLoading}
                networkId={device.networkId}
                nodes={topology?.nodes ?? []}
              />
            </aside>
          </div>

          {canManage ? (
            <section className="rounded-xl bg-card shadow-sm ring-1 ring-line">
              <div className="px-4 py-4 sm:px-5">
                <h2 className="text-base leading-6 font-semibold tracking-[-0.006em]">
                  {t("deviceStatus.danger.title")}
                </h2>
                <p className="text-[13px] text-fg-3">
                  {t("deviceStatus.danger.hint")}
                </p>
              </div>
              <div className="flex flex-col gap-2 border-t border-line px-4 py-4 sm:flex-row sm:px-5">
                {blocked ? (
                  <Button
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate({ deviceId: device.id, data: {} })
                    }
                    variant="outline"
                  >
                    <ShieldCheckIcon className="size-4" />
                    {t("common.unblock")}
                  </Button>
                ) : (
                  <Button
                    disabled={block.isPending}
                    onClick={() => askRemoval("block")}
                    variant="outline"
                  >
                    <BanIcon className="size-4" />
                    {t("common.block")}
                  </Button>
                )}
                <Button
                  disabled={remove.isPending}
                  onClick={() => askRemoval("delete")}
                  variant="destructive"
                >
                  <TrashIcon className="size-4" />
                  {t("common.remove")}
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </PageContainer>

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
        deviceName={name}
        deviceId={device.id}
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
        networkId={device.networkId}
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
        useRendezvous={network?.useRendezvous ?? false}
      />
    </>
  )
}

/**
 * Calm explanation of the current state. It replaces the old red "config N
 * isn't applied" alert: offline devices get an explanation, not a scolding and
 * a Retry button that cannot work.
 */
function DeviceStatusBlock({
  device,
  status,
  canManage,
  applying,
  approving,
  onRetry,
  onApprove,
}: {
  device: {
    lastPushError: string | null
    lastSeenAt: string | null
    appliedRevision: number | null
  }
  status: DeviceStatus
  canManage: boolean
  applying: boolean
  approving: boolean
  onRetry: () => void
  onApprove: () => void
}) {
  const { t, i18n } = useTranslation()
  if (status.kind === "online") return null

  const relative = formatRelativeTime(device.lastSeenAt, i18n.language)
  const tone =
    status.kind === "pending"
      ? "bg-brand-soft ring-line"
      : status.kind === "updating"
        ? "bg-warn-soft ring-warn-line"
        : status.kind === "push-failed"
          ? "bg-err-soft ring-err-line"
          : "bg-surface-2 ring-line"
  const iconTone =
    status.kind === "pending"
      ? "text-brand-text"
      : status.kind === "updating"
        ? "text-warn"
        : status.kind === "push-failed"
          ? "text-err"
          : "text-fg-3"

  const content = (() => {
    switch (status.kind) {
      case "blocked":
        return {
          title: t("deviceStatus.block.blockedTitle"),
          body: t("deviceStatus.block.blockedBody"),
        }
      case "pending":
        return {
          title: t("deviceStatus.block.pendingTitle"),
          body: t("deviceStatus.block.pendingBody"),
        }
      case "offline":
        return {
          title: t("deviceStatus.block.offlineTitle"),
          body:
            status.pendingRevision !== null
              ? t("deviceStatus.block.offlinePending", {
                  revision: status.pendingRevision,
                  when: relative ?? t("common.none"),
                })
              : t("deviceStatus.block.offlineBody", {
                  when: relative ?? t("common.none"),
                }),
        }
      case "updating":
        return {
          title: t("deviceStatus.block.updatingTitle", {
            revision: status.pendingRevision ?? device.appliedRevision ?? "—",
          }),
          body: t("deviceStatus.block.updatingBody", {
            applied: device.appliedRevision ?? "—",
          }),
        }
      case "push-failed":
        return {
          title: t("deviceStatus.block.pushFailedTitle"),
          body: status.reason
            ? t("deviceStatus.block.pushFailedReason", {
                reason: status.reason,
              })
            : t("deviceStatus.block.pushFailedBody"),
        }
      default:
        return { title: "", body: "" }
    }
  })()

  const icon =
    status.kind === "blocked" ? (
      <LockIcon aria-hidden="true" className="size-4" />
    ) : status.kind === "pending" ? (
      <ClockIcon aria-hidden="true" className="size-4" />
    ) : status.kind === "offline" ? (
      <WifiOffIcon aria-hidden="true" className="size-4" />
    ) : status.kind === "updating" ? (
      <RefreshCwIcon aria-hidden="true" className="size-4" />
    ) : (
      <AlertTriangleIcon aria-hidden="true" className="size-4" />
    )

  return (
    <section
      className={`flex flex-wrap items-start gap-3 rounded-xl px-4 py-3.5 ring-1 ${tone}`}
      role="status"
    >
      <span aria-hidden="true" className={`mt-0.5 ${iconTone}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{content.title}</p>
        <p className="mt-0.5 text-[13px] break-words text-fg-2">
          {content.body}
        </p>
      </div>
      {canManage && status.kind === "pending" ? (
        <Button
          className="flex-none max-sm:w-full"
          disabled={approving}
          onClick={onApprove}
        >
          <ShieldCheckIcon className="size-4" />
          {t("common.approve")}
        </Button>
      ) : null}
      {canManage &&
      (status.kind === "updating" || status.kind === "push-failed") ? (
        <Button
          className="flex-none max-sm:w-full"
          disabled={applying}
          onClick={onRetry}
          variant="outline"
        >
          <RefreshCwIcon className="size-4" />
          {t("common.retry")}
        </Button>
      ) : null}
    </section>
  )
}
