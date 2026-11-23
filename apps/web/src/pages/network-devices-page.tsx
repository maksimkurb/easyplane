import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { SearchIcon } from "lucide-react"

import { useListNetworkRoutes } from "@/api/generated/easyplane"
import type { ListNetworkRoutes200RoutesItem } from "@/api/generated/model"
import { ApprovalsPanel } from "@/components/network/approvals-panel"
import {
  NetworkShell,
  type NetworkShellData,
} from "@/components/network/network-shell"
import { DeviceRow } from "@/components/device/device-row"
import { WireguardClientsCard } from "@/components/device/wireguard-clients-card"
import { RouteLoadError } from "@/components/routes/route-load-error"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { deriveDeviceStatus } from "@/lib/device-status"
import { deviceName } from "@/lib/device-presentation"
import { retryableQuery } from "@/lib/query-retry"
import { MonitorSmartphoneIcon } from "lucide-react"

type Filter = "all" | "online" | "offline" | "attention"

export function NetworkDevicesPage({ networkId }: { networkId: string }) {
  return (
    <NetworkShell networkId={networkId} tab="devices">
      {(data) => <DevicesTab data={data} />}
    </NetworkShell>
  )
}

function DevicesTab({ data }: { data: NetworkShellData }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  // The shell already loads the routes; this observer only adds the retry
  // policy from lib/query-retry and gives the page an error state to show.
  // Same query key, so no extra request is made.
  const routesQuery = useListNetworkRoutes(data.network.id, {
    query: retryableQuery,
  })

  // Pending devices belong to the approvals block, not to this list.
  const rows = useMemo(
    () => data.devices.filter((device) => device.state !== "pending"),
    [data.devices]
  )
  const statuses = useMemo(
    () =>
      new Map(rows.map((device) => [device.id, deriveDeviceStatus(device)])),
    [rows]
  )
  const onlineCount = rows.filter(
    (device) => statuses.get(device.id)?.connected
  ).length
  const offlineCount = rows.length - onlineCount
  const attentionCount = rows.filter(
    (device) => statuses.get(device.id)?.needsAttention
  ).length

  const routesByDevice = useMemo(() => {
    const map = new Map<string, ListNetworkRoutes200RoutesItem[]>()
    for (const route of data.routes) {
      const list = map.get(route.deviceId) ?? []
      list.push(route)
      map.set(route.deviceId, list)
    }
    return map
  }, [data.routes])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((device) => {
      const status = statuses.get(device.id)
      if (filter === "online" && !status?.connected) return false
      if (filter === "offline" && status?.connected) return false
      if (filter === "attention" && !status?.needsAttention) return false
      if (!needle) return true
      const haystack = [
        deviceName(device),
        device.hostname,
        device.label,
        device.dnsName ?? "",
        device.virtualIpv4 ?? "",
        device.machineId,
        ...device.tags,
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [rows, filter, query, statuses])

  return (
    <>
      <ApprovalsPanel
        devices={data.devices}
        invites={data.invites}
        networkId={data.network.id}
        routes={data.routes}
      />

      {routesQuery.isError ? (
        <RouteLoadError
          className="mb-4"
          onRetry={() => void routesQuery.refetch()}
          pending={routesQuery.isFetching}
        />
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-[320px] sm:flex-none">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
          />
          <Input
            aria-label={t("devices.searchLabel")}
            className="min-h-11 pl-9 text-ellipsis sm:min-h-10"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("devices.searchPlaceholder")}
            type="search"
            value={query}
          />
        </div>
        <div className="relative min-w-0 max-sm:w-full sm:flex-1">
          <div className="overflow-x-auto pb-0.5 [scrollbar-width:none] max-sm:w-full [&::-webkit-scrollbar]:hidden">
            <Segmented
              className="max-sm:w-full max-sm:[&>button]:h-11 max-sm:[&>button]:min-w-0 max-sm:[&>button]:flex-1 max-sm:[&>button]:gap-1 max-sm:[&>button]:px-1.5"
              label={t("devices.filterLabel")}
              onValueChange={setFilter}
              options={[
                {
                  value: "all",
                  label: t("deviceStatus.filters.all"),
                  count: rows.length,
                },
                {
                  value: "online",
                  label: t("deviceStatus.filters.online"),
                  count: onlineCount,
                },
                {
                  value: "offline",
                  label: t("deviceStatus.filters.offline"),
                  count: offlineCount,
                },
                {
                  value: "attention",
                  label: t("deviceStatus.filters.attention"),
                  count: attentionCount,
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
      </div>

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MonitorSmartphoneIcon />
            </EmptyMedia>
            <EmptyTitle>{t("devices.title")}</EmptyTitle>
            <EmptyDescription>{t("devices.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
          <div
            aria-hidden="true"
            className="hidden h-10 grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-x-2 border-b border-line px-4 text-xs font-medium text-fg-3 md:grid md:gap-x-4 md:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(120px,1fr)_minmax(130px,1fr)_minmax(130px,1fr)_40px]"
          >
            <span>{t("devices.table.device")}</span>
            <span className="hidden lg:block">
              {t("devices.table.address")}
            </span>
            <span className="hidden lg:block">{t("devices.table.system")}</span>
            <span>{t("deviceStatus.table.status")}</span>
            <span />
          </div>
          {filtered.length === 0 ? (
            <p className="flex min-h-28 items-center justify-center px-4 text-center text-sm text-fg-3">
              {query.trim()
                ? t("devices.noMatches")
                : t("deviceStatus.filters.empty")}
            </p>
          ) : (
            <div className="divide-y divide-line">
              {filtered.map((device) => (
                <DeviceRow
                  credentialsMode={data.network.access.mode === "credentials"}
                  device={device}
                  key={device.id}
                  networkId={data.network.id}
                  routes={routesByDevice.get(device.id) ?? []}
                  useRendezvous={data.network.useRendezvous}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <WireguardClientsCard devices={data.devices} networkId={data.network.id} />
    </>
  )
}
