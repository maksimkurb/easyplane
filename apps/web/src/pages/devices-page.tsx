import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { CheckIcon, MonitorSmartphoneIcon, RefreshCwIcon, ShieldBanIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import {
  useApproveDevice,
  useBlockDevice,
  useDeleteDevice,
  useListDevices,
  useListNetworks,
  usePushDeviceConfig,
  useRevokeDeviceCredential,
} from "@/api/generated/easyplane"
import type { ListDevicesState } from "@/api/generated/model"
import { useAuth } from "@/auth/auth-context"
import { AnchorRemovalDialog } from "@/components/anchor-removal-dialog"
import { DeviceStatusBadges } from "@/components/device-status"
import { DeviceRoleBadge } from "@/components/network-access-card"
import { PageContainer } from "@/components/layout/page-container"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

const STATES: ListDevicesState[] = ["pending", "approved", "blocked"]

export function DevicesPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const { t } = useTranslation()
  const { canManage } = useAuth()
  const [networkId, setNetworkId] = useState<string>("all")
  const [state, setState] = useState<ListDevicesState | "all">(
    pendingOnly ? "pending" : "all"
  )
  const [anchorTarget, setAnchorTarget] = useState<{
    deviceId: string
    hostname: string
    networkId: string
    operation: "block" | "delete"
    useRendezvous: boolean
  } | null>(null)

  const networksQuery = useListNetworks()
  const devicesQuery = useListDevices({
    networkId: networkId === "all" ? undefined : networkId,
    state: state === "all" ? undefined : state,
  })
  const approve = useApproveDevice({
    mutation: {
      onSuccess: () => toast.success(t("devices.approved")),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const block = useBlockDevice({
    mutation: {
      onSuccess: () => toast.success(t("devices.blocked")),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const remove = useDeleteDevice({
    mutation: {
      onSuccess: () => toast.success(t("devices.deleted")),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const push = usePushDeviceConfig({
    mutation: {
      onSuccess: () => toast.success(t("devices.pushRequested")),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })
  const revoke = useRevokeDeviceCredential({
    mutation: {
      onSuccess: () => toast.success(t("access.revoked")),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : t("common.error")),
    },
  })

  const networks = networksQuery.data?.data
  const devices = devicesQuery.data?.data ?? []
  const credentialsMode = (id: string) =>
    (networks ?? []).find((network) => network.id === id)?.access.mode ===
    "credentials"
  const networkNames = useMemo(
    () => new Map((networks ?? []).map((network) => [network.id, network.name])),
    [networks]
  )

  return (
    <PageContainer className="py-6 sm:py-8">
      <>
      <PageHeader
        description={
          pendingOnly ? t("devices.pendingDescription") : t("devices.description")
        }
        title={pendingOnly ? t("devices.pendingTitle") : t("devices.title")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          items={[
            { value: "all", label: t("devices.all") },
            ...(networks ?? []).map((network) => ({ value: network.id, label: network.name })),
          ]}
          onValueChange={(value) => value && setNetworkId(value)}
          value={networkId}
        >
          <SelectTrigger aria-label={t("networks.title")} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("devices.all")}</SelectItem>
            {(networks ?? []).map((network) => (
              <SelectItem key={network.id} value={network.id}>
                {network.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!pendingOnly ? (
          <Select
            items={[
              { value: "all", label: t("devices.all") },
              ...STATES.map((entry) => ({
                value: entry,
                label: t(`devices.status.${entry}`),
              })),
            ]}
            onValueChange={(value) => value && setState(value as ListDevicesState | "all")}
            value={state}
          >
            <SelectTrigger aria-label={t("common.status")} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("devices.all")}</SelectItem>
              {STATES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {t(`devices.status.${entry}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Button
          onClick={() => void devicesQuery.refetch()}
          size="sm"
          variant="outline"
        >
          <RefreshCwIcon className="size-4" />
          {t("common.refresh")}
        </Button>
      </div>

      {devicesQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : devices.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MonitorSmartphoneIcon />
            </EmptyMedia>
            <EmptyTitle>
              {pendingOnly ? t("devices.noPending") : t("devices.title")}
            </EmptyTitle>
            <EmptyDescription>{t("devices.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("devices.hostname")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("access.role")}</TableHead>
                <TableHead>{t("networks.title")}</TableHead>
                <TableHead>{t("devices.os")}</TableHead>
                <TableHead>{t("devices.virtualIp")}</TableHead>
                <TableHead>{t("devices.lastSeen")}</TableHead>
                <TableHead>{t("devices.appliedRevision")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/devices/${device.id}`}
                    >
                      {device.hostname || device.machineId.slice(0, 8)}
                    </Link>
                    <div className="max-w-56 truncate font-mono text-[10px] text-muted-foreground">
                      {device.machineId}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DeviceStatusBadges
                      online={device.online}
                      state={device.state}
                      sync={device.sync}
                    />
                  </TableCell>
                  <TableCell>
                    <DeviceRoleBadge
                      expiresAt={device.credential?.expiry}
                      role={device.effectiveRole}
                      status={device.credential?.status}
                    />
                    {device.knowsSecret ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {t("access.knowsSecret")}
                      </div>
                    ) : device.credential ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {t(`access.credentialStatus.${device.credential.status}`)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{networkNames.get(device.networkId) ?? t("common.none")}</TableCell>
                  <TableCell className="max-w-48 text-xs">
                    {device.os.distribution || device.os.type || t("common.none")}
                    {device.os.version ? ` ${device.os.version}` : ""}
                    <div className="text-muted-foreground">
                      {device.easytierVersion || t("common.none")}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {device.virtualIpv4 ?? t("common.none")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {device.lastSeenAt
                      ? new Date(device.lastSeenAt).toLocaleString()
                      : t("common.none")}
                  </TableCell>
                  <TableCell>
                    {device.appliedRevision ?? t("common.none")}
                    {device.desiredRevision !== null &&
                    device.appliedRevision !== device.desiredRevision ? (
                      <span className="text-amber-600"> / {device.desiredRevision}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      {canManage && device.state !== "approved" ? (
                        <Button
                          disabled={approve.isPending}
                          onClick={() => approve.mutate({ deviceId: device.id, data: {} })}
                          size="sm"
                          variant="outline"
                        >
                          <CheckIcon className="size-4" />
                          {t("common.approve")}
                        </Button>
                      ) : null}
                      {canManage && device.state === "approved" ? (
                        <>
                          <Button
                            disabled={push.isPending}
                            onClick={() => push.mutate({ deviceId: device.id })}
                            size="sm"
                            variant="outline"
                          >
                            <RefreshCwIcon className="size-4" />
                          </Button>
                          {credentialsMode(device.networkId) &&
                          device.effectiveRole === "member" ? (
                            <Button
                              disabled={revoke.isPending}
                              onClick={() => {
                                if (window.confirm(t("access.revokeConfirm", { hostname: device.hostname }))) {
                                  revoke.mutate({ deviceId: device.id })
                                }
                              }}
                              size="sm"
                              variant="outline"
                            >
                              <ShieldBanIcon className="size-4" />
                              {t("access.revoke")}
                            </Button>
                          ) : (
                            <Button
                              onClick={() => {
                                if (
                                  credentialsMode(device.networkId) &&
                                  device.effectiveRole === "anchor"
                                ) {
                                  setAnchorTarget({
                                    deviceId: device.id,
                                    hostname: device.hostname,
                                    networkId: device.networkId,
                                    operation: "block",
                                    useRendezvous:
                                      (networks ?? []).find(
                                        (network) => network.id === device.networkId,
                                      )?.useRendezvous ?? false,
                                  })
                                  return
                                }
                                if (window.confirm(t("devices.blockConfirm"))) {
                                  block.mutate({ deviceId: device.id, data: {} })
                                }
                              }}
                              size="sm"
                              variant="outline"
                            >
                              <ShieldBanIcon className="size-4" />
                              {t("common.block")}
                            </Button>
                          )}
                        </>
                      ) : null}
                      {canManage ? (
                        <Button
                          onClick={() => {
                            if (
                              credentialsMode(device.networkId) &&
                              device.effectiveRole === "anchor"
                            ) {
                              setAnchorTarget({
                                deviceId: device.id,
                                hostname: device.hostname,
                                networkId: device.networkId,
                                operation: "delete",
                                useRendezvous:
                                  (networks ?? []).find(
                                    (network) => network.id === device.networkId,
                                  )?.useRendezvous ?? false,
                              })
                              return
                            }
                            if (window.confirm(t("devices.deleteConfirm"))) {
                              remove.mutate({ deviceId: device.id, data: {} })
                            }
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AnchorRemovalDialog
        hostname={anchorTarget?.hostname ?? ""}
        networkId={anchorTarget?.networkId ?? ""}
        onClose={() => setAnchorTarget(null)}
        onConfirm={() => {
          if (!anchorTarget) return
          if (anchorTarget.operation === "block") {
            block.mutate({ deviceId: anchorTarget.deviceId, data: { acknowledgeAnchorRisk: true } })
          } else {
            remove.mutate({ deviceId: anchorTarget.deviceId, data: { acknowledgeAnchorRisk: true } })
          }
          setAnchorTarget(null)
        }}
        open={anchorTarget !== null}
        operation={anchorTarget?.operation ?? "block"}
        pending={block.isPending || remove.isPending}
        useRendezvous={anchorTarget?.useRendezvous ?? false}
      />
      </>
    </PageContainer>
  )
}
