import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { SearchIcon } from "lucide-react"

import type { ListNetworkRoutes200RoutesItem } from "@/api/generated/model"
import { ApprovalsPanel } from "@/components/network/approvals-panel"
import { NetworkShell, type NetworkShellData } from "@/components/network/network-shell"
import { DeviceRow } from "@/components/device/device-row"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { deviceHasIssue, deviceName } from "@/lib/device-presentation"
import { MonitorSmartphoneIcon } from "lucide-react"

type Filter = "all" | "online" | "issues"

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

  // Pending devices belong to the approvals block, not to this list.
  const rows = useMemo(
    () => data.devices.filter((device) => device.state !== "pending"),
    [data.devices]
  )
  const onlineCount = rows.filter((device) => device.online === "online").length
  const issueCount = rows.filter(deviceHasIssue).length

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
      if (filter === "online" && device.online !== "online") return false
      if (filter === "issues" && !deviceHasIssue(device)) return false
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
  }, [rows, filter, query])

  return (
    <>
      <ApprovalsPanel
        devices={data.devices}
        invites={data.invites}
        networkId={data.network.id}
        routes={data.routes}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-[320px] sm:flex-none">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
          />
          <Input
            aria-label={t("devices.searchLabel")}
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("devices.searchPlaceholder")}
            type="search"
            value={query}
          />
        </div>
        <Segmented
          className="max-sm:w-full"
          label={t("devices.filterLabel")}
          onValueChange={setFilter}
          options={[
            { value: "all", label: t("devices.filterAll"), count: rows.length },
            { value: "online", label: t("devices.filterOnline"), count: onlineCount },
            { value: "issues", label: t("devices.filterIssues"), count: issueCount },
          ]}
          value={filter}
        />
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
            <span className="hidden lg:block">{t("devices.table.address")}</span>
            <span className="hidden lg:block">{t("devices.table.system")}</span>
            <span>{t("devices.table.lastSeen")}</span>
            <span />
          </div>
          {filtered.length === 0 ? (
            <p className="flex min-h-28 items-center justify-center px-4 text-center text-sm text-fg-3">
              {t("devices.noMatches")}
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
    </>
  )
}
