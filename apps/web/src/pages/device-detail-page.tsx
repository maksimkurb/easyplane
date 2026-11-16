import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useParams } from "wouter"
import {
  BanIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
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
import { DeviceAccessCard } from "@/components/device-access-card"
import { DeviceConnectionsCard } from "@/components/device/device-connections-card"
import { DeviceDetailsCard } from "@/components/device/device-details-card"
import { DeviceHistoryCard } from "@/components/device/device-history-card"
import { DeviceIcon } from "@/components/device/device-icon"
import { DeviceHubCard } from "@/components/device/device-hub-card"
import { DeviceRenameDialog } from "@/components/device/device-rename-dialog"
import { DeviceTagsDialog } from "@/components/device/device-tags-dialog"
import { DeviceRoutesCard } from "@/components/routes/device-routes-card"
import { Button } from "@/components/ui/button"
import { Chip, Dot } from "@/components/ui/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyInline } from "@/components/shared/copy-inline"
import { deviceName, osLabel } from "@/lib/device-presentation"

export function DeviceDetailPage() {
  const { t } = useTranslation()
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [, navigate] = useLocation()
  const { canManage } = useAuth()
  const [renameOpen, setRenameOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [anchorOperation, setAnchorOperation] = useState<"block" | "delete" | null>(null)

  const deviceQuery = useGetDevice(id)
  const revisionsQuery = useListDeviceRevisions(id)
  const routesQuery = useListDeviceRoutes(id)
  const device = deviceQuery.data?.data
  const networkQuery = useGetNetwork(device?.networkId ?? "", {
    query: { enabled: Boolean(device?.networkId) },
  })
  const topologyQuery = useGetNetworkTopology(device?.networkId ?? "", undefined, {
    query: { enabled: Boolean(device?.networkId) },
  })

  const revisions = revisionsQuery.data?.data ?? []
  const routes = routesQuery.data?.data ?? []
  const network = networkQuery.data?.data
  const topology = topologyQuery.data?.data
  const topologyNode =
    topology?.nodes.find((node) => node.deviceId === device?.id) ?? null
  const publicIp = topologyNode?.publicIps[0] ?? null

  const refresh = async () => {
    if (!device) return
    await queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(device.id) })
    await queryClient.invalidateQueries({ queryKey: getListDeviceRevisionsQueryKey(device.id) })
    await queryClient.invalidateQueries({ queryKey: getListDeviceRoutesQueryKey(device.id) })
    await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
    await queryClient.invalidateQueries({
      queryKey: getListNetworkRoutesQueryKey(device.networkId),
    })
    await queryClient.invalidateQueries({ queryKey: getGetNetworkQueryKey(device.networkId) })
  }
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("common.error"))

  const push = usePushDeviceConfig({
    mutation: {
      onSuccess: () => toast.success(t("devices.pushRequested")),
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
        await queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() })
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

  const name = deviceName(device)
  const online = device.online === "online"
  const blocked = device.state === "blocked"
  const pendingRevision =
    device.desiredRevision !== null &&
    device.appliedRevision !== device.desiredRevision
  const showBanner = Boolean(device.lastPushError) || pendingRevision
  const credentialsMode = device.accessMode === "credentials"

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
    <>
      <section className="border-b border-line bg-card">
        <PageContainer className="py-4 sm:py-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:flex-nowrap">
            <span className="grid size-12 flex-none place-items-center rounded-xl bg-surface-2 text-fg-2 ring-1 ring-line">
              <DeviceIcon className="size-6" os={device.os} />
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
                  <Chip variant="brand">{t("devices.detail.hub.badge")}</Chip>
                ) : null}
                <ExitNodeBadge state={device.exitNode} />
                {device.configManagedLocally ? (
                  <Chip variant="warn">{t("devices.localConfig")}</Chip>
                ) : null}
                {blocked ? <Chip variant="err">{t("devices.status.blocked")}</Chip> : null}
                {device.sync === "stale" && !device.lastPushError ? (
                  <Chip variant="warn">{t("devices.chips.configNotApplied")}</Chip>
                ) : null}
                {device.sync === "error" || device.lastPushError ? (
                  <Chip variant="err">{t("devices.chips.pushFailed")}</Chip>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                  <Dot online={online && !blocked} />
                  {blocked
                    ? t("devices.status.blocked")
                    : online
                      ? t("devices.connected")
                      : t("devices.status.offline")}
                </span>
                {device.virtualIpv4 ? (
                  <CopyInline
                    className="-ml-1.5"
                    label={t("devices.copyVirtualIp")}
                    value={device.virtualIpv4}
                  />
                ) : null}
                <span className="max-sm:hidden">{osLabel(device.os)}</span>
                {device.easytierVersion ? (
                  <span className="max-sm:hidden">EasyTier {device.easytierVersion}</span>
                ) : null}
              </div>
            </div>

            <div className="flex w-full gap-2 sm:w-auto sm:flex-none">
              {canManage && device.state === "approved" ? (
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
              {canManage ? (
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
                    <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                      <PencilIcon />
                      {t("devices.menu.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTagsOpen(true)}>
                      <TagIcon />
                      {t("devices.menu.tags")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/networks/${device.networkId}/map`)}>
                      {t("network.tabs.map")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>
        </PageContainer>
      </section>

      <PageContainer className="py-5">
        <div className="flex flex-col gap-5">
          {showBanner ? (
            <div
              className="flex flex-wrap items-start gap-3 rounded-xl bg-err-soft px-4 py-3.5 ring-1 ring-err-line"
              role="alert"
            >
              <span aria-hidden="true" className="mt-0.5 text-err">
                <ShieldCheckIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">
                  {pendingRevision
                    ? t("devices.detail.notAppliedTitle", {
                        desired: device.desiredRevision,
                        applied: device.appliedRevision ?? "—",
                      })
                    : t("devices.detail.pushFailedTitle")}
                </p>
                <p className="mt-0.5 text-[13px] text-fg-2">
                  {device.lastPushError || t("devices.detail.waitingForDevice")}
                </p>
              </div>
              {canManage && device.state === "approved" ? (
                <Button
                  className="flex-none max-sm:w-full"
                  disabled={push.isPending}
                  onClick={() => push.mutate({ deviceId: device.id })}
                  variant="outline"
                >
                  {t("common.retry")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-5">
              <DeviceRoutesCard device={device} routes={routes} />
              <DeviceHubCard device={device} />
              <DeviceHistoryCard device={device} revisions={revisions} />
            </div>

            <aside className="flex w-full min-w-0 flex-col gap-5 xl:w-[340px] xl:flex-none">
              <DeviceDetailsCard device={device} publicIp={publicIp} />
              <DeviceAccessCard device={device} />
              <DeviceConnectionsCard
                deviceId={device.id}
                links={topology?.links ?? []}
                loading={topologyQuery.isLoading}
                networkId={device.networkId}
                nodes={topology?.nodes ?? []}
              />
              {canManage ? (
                <div className="grid grid-cols-2 gap-2">
                  {blocked ? (
                    <Button
                      disabled={approve.isPending}
                      onClick={() => approve.mutate({ deviceId: device.id, data: {} })}
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
              ) : null}
            </aside>
          </div>
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
