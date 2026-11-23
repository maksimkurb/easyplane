import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import {
  MonitorSmartphoneIcon,
  NetworkIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"

import { useListDevices, useListNetworks } from "@/api/generated/easyplane"
import type { ListDevices200Item } from "@/api/generated/model"
import { DeviceRow } from "@/components/device/device-row"
import { PageContainer } from "@/components/layout/page-container"
import { PendingDeviceRow } from "@/components/layout/pending-device-row"
import { PageHeader } from "@/components/shared/page-header"
import { LinkButton } from "@/components/shared/link-button"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/ui/segmented"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { deviceHasIssue, deviceName } from "@/lib/device-presentation"

type Filter = "all" | "online" | "issues" | "pending"

/**
 * All devices across every network. Rows deliberately share the look of a
 * network's device list (same grid, chips, menu) and add a network heading, so a
 * device that is reachable from the global page is never mistaken for one from
 * another network. Pending devices get inline Approve/Reject here as well.
 */
export function DevicesPage({
  pendingOnly = false,
}: {
  pendingOnly?: boolean
}) {
  const { t } = useTranslation()
  const [networkId, setNetworkId] = useState("all")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>(pendingOnly ? "pending" : "all")

  const networksQuery = useListNetworks()
  const devicesQuery = useListDevices()
  const networks = useMemo(
    () => networksQuery.data?.data ?? [],
    [networksQuery.data]
  )
  const devices = useMemo(
    () => devicesQuery.data?.data ?? [],
    [devicesQuery.data]
  )

  const networkById = useMemo(
    () => new Map(networks.map((network) => [network.id, network])),
    [networks]
  )

  const counts = useMemo(
    () => ({
      all: devices.length,
      online: devices.filter((device) => device.online === "online").length,
      issues: devices.filter(deviceHasIssue).length,
      pending: devices.filter((device) => device.state === "pending").length,
    }),
    [devices]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return devices.filter((device) => {
      if (networkId !== "all" && device.networkId !== networkId) return false
      if (filter === "online" && device.online !== "online") return false
      if (filter === "issues" && !deviceHasIssue(device)) return false
      if (filter === "pending" && device.state !== "pending") return false
      if (!needle) return true
      const haystack = [
        deviceName(device),
        device.hostname,
        device.label,
        device.description ?? "",
        device.dnsName ?? "",
        device.virtualIpv4 ?? "",
        device.machineId,
        device.networkName,
        ...device.tags,
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [devices, filter, networkId, query])

  const groups = useMemo(() => {
    const order = new Map(networks.map((network, index) => [network.id, index]))
    const byNetwork = new Map<string, ListDevices200Item[]>()
    for (const device of filtered) {
      const list = byNetwork.get(device.networkId) ?? []
      list.push(device)
      byNetwork.set(device.networkId, list)
    }
    return [...byNetwork.entries()]
      .map(([id, list]) => ({
        id,
        name:
          list[0]?.networkName || networkById.get(id)?.name || id.slice(0, 8),
        devices: list,
      }))
      .sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      )
  }, [filtered, networkById, networks])

  const emptyState = (() => {
    if (devices.length === 0) {
      return {
        title: t("devicesGlobal.emptyNoDevices"),
        description: t("devicesGlobal.emptyNoDevicesHint"),
        cta: true,
      }
    }
    if (filter === "pending") {
      return {
        title: t("devicesGlobal.emptyPending"),
        description: t("devicesGlobal.emptyPendingHint"),
        cta: false,
      }
    }
    if (query.trim()) {
      return {
        title: t("devicesGlobal.noMatches"),
        description: t("devicesGlobal.emptyFilterHint"),
        cta: false,
      }
    }
    if (filter === "online") {
      return {
        title: t("devicesGlobal.emptyOnline"),
        description: t("devicesGlobal.emptyFilterHint"),
        cta: false,
      }
    }
    if (filter === "issues") {
      return {
        title: t("devicesGlobal.emptyIssues"),
        description: t("devicesGlobal.emptyFilterHint"),
        cta: false,
      }
    }
    return {
      title: t("devicesGlobal.emptyNetwork"),
      description: t("devicesGlobal.emptyFilterHint"),
      cta: false,
    }
  })()

  const resetFilters = () => {
    setQuery("")
    setNetworkId("all")
    setFilter(pendingOnly ? "pending" : "all")
  }

  const networkOptions = [
    { value: "all", label: t("devicesGlobal.allNetworks") },
    ...networks.map((network) => ({ value: network.id, label: network.name })),
  ]

  return (
    <PageContainer className="py-6 sm:py-8">
      <PageHeader
        description={
          pendingOnly
            ? t("devicesGlobal.pendingDescription")
            : t("devicesGlobal.description")
        }
        title={
          pendingOnly
            ? t("devicesGlobal.pendingTitle")
            : t("devicesGlobal.title")
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 sm:max-w-[320px]">
            <Label
              className="mb-1.5 text-xs text-fg-3"
              htmlFor="devices-search"
            >
              {t("devicesGlobal.searchLabel")}
            </Label>
            <div className="relative">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
              />
              <Input
                className="min-h-11 pl-9 text-ellipsis sm:min-h-10"
                id="devices-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("devicesGlobal.searchPlaceholder")}
                type="search"
                value={query}
              />
            </div>
          </div>

          <div className="w-full min-w-0 sm:w-64 sm:flex-none">
            <Label
              className="mb-1.5 text-xs text-fg-3"
              htmlFor="devices-network-filter"
            >
              {t("devicesGlobal.networkFilter")}
            </Label>
            <Select
              items={networkOptions}
              onValueChange={(value) => value && setNetworkId(value)}
              value={networkId}
            >
              <SelectTrigger
                className="w-full sm:max-w-none"
                id="devices-network-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("devicesGlobal.allNetworks")}
                </SelectItem>
                {networks.map((network) => (
                  <SelectItem key={network.id} value={network.id}>
                    {network.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 max-w-full">
            <div className="overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Segmented
                className="max-sm:[&>button]:h-11"
                label={t("devicesGlobal.filterLabel")}
                onValueChange={setFilter}
                options={[
                  {
                    value: "all",
                    label: t("devicesGlobal.filterAll"),
                    count: counts.all,
                  },
                  {
                    value: "online",
                    label: t("devicesGlobal.filterOnline"),
                    count: counts.online,
                  },
                  {
                    value: "issues",
                    label: t("devicesGlobal.filterIssues"),
                    count: counts.issues,
                  },
                  {
                    value: "pending",
                    label: t("devicesGlobal.filterPending"),
                    count: counts.pending,
                  },
                ]}
                value={filter}
              />
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent md:hidden"
            />
          </div>
          <Button
            aria-label={t("common.refresh")}
            className="ml-auto max-sm:flex-none"
            disabled={devicesQuery.isFetching}
            onClick={() => void devicesQuery.refetch()}
            size="sm"
            variant="outline"
          >
            <RefreshCwIcon className="size-4" />
            <span className="max-sm:sr-only">{t("common.refresh")}</span>
          </Button>
        </div>
      </div>

      {devicesQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : devices.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MonitorSmartphoneIcon />
            </EmptyMedia>
            <EmptyTitle>{emptyState.title}</EmptyTitle>
            <EmptyDescription>{emptyState.description}</EmptyDescription>
          </EmptyHeader>
          {emptyState.cta ? (
            <EmptyContent>
              <LinkButton href="/networks" variant="outline">
                {t("devicesGlobal.goToNetworks")}
              </LinkButton>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MonitorSmartphoneIcon />
            </EmptyMedia>
            <EmptyTitle>{emptyState.title}</EmptyTitle>
            <EmptyDescription>{emptyState.description}</EmptyDescription>
          </EmptyHeader>
          {/* "Nothing is waiting for approval" is a finished state, not a
              filtered one: a reset button there would suggest a hidden list. */}
          {filter === "pending" && !query.trim() ? null : (
            <EmptyContent>
              <Button onClick={resetFilters} size="sm" variant="outline">
                {t("devicesGlobal.clearFilters")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
          {groups.map((group) => {
            const network = networkById.get(group.id)
            const approved = group.devices.filter(
              (device) => device.state === "approved"
            )
            const online = approved.filter(
              (device) => device.online === "online"
            ).length
            const waiting = group.devices.filter(
              (device) => device.state === "pending"
            ).length
            return (
              <section
                aria-label={group.name}
                className="border-b border-line last:border-b-0"
                key={group.id}
              >
                <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface-2/50 px-4 py-1.5 md:px-5">
                  <NetworkIcon
                    aria-hidden="true"
                    className="size-4 flex-none text-fg-3"
                  />
                  <Link
                    className="min-w-0 truncate text-[13px] font-medium hover:underline"
                    href={`/networks/${group.id}`}
                  >
                    {group.name}
                  </Link>
                  <span className="text-xs text-fg-3">
                    {t("devicesGlobal.deviceCount", {
                      count: group.devices.length,
                    })}
                    {approved.length > 0
                      ? ` · ${t("networks.onlineOf", { online, total: approved.length })}`
                      : null}
                  </span>
                  {waiting > 0 ? (
                    <span className="ml-auto text-xs font-medium whitespace-nowrap text-warn">
                      {t("devicesGlobal.waitingCount", { count: waiting })}
                    </span>
                  ) : null}
                </div>

                <div className="divide-y divide-line">
                  {group.devices.map((device) =>
                    device.state === "pending" ? (
                      <PendingDeviceRow
                        device={device}
                        key={device.id}
                        networkName={group.name}
                      />
                    ) : (
                      <DeviceRow
                        credentialsMode={
                          network?.access.mode === "credentials"
                        }
                        device={device}
                        key={device.id}
                        networkId={device.networkId}
                        networkName={group.name}
                        useRendezvous={network?.useRendezvous ?? false}
                      />
                    )
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
