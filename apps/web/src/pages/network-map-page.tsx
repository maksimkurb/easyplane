import { useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  InfoIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  ServerIcon,
  XIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import {
  getGetNetworkTopologyQueryKey,
  getNetworkTopology,
  useGetNetworkTopology,
  useListNetworkRoutes,
} from "@/api/generated/easyplane"
import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
  ListDevices200Item,
} from "@/api/generated/model"
import {
  NetworkShell,
  type NetworkShellData,
} from "@/components/network/network-shell"
import { DeviceIcon } from "@/components/device/device-icon"
import { DeviceStatusCell } from "@/components/device/device-status-cell"
import { LiveStatus } from "@/components/live-status"
import { CompactTopologyMap } from "@/components/topology/compact-topology-map"
import { TopologyMap } from "@/components/topology/topology-map"
import { RouteLoadError } from "@/components/routes/route-load-error"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/shared/link-button"
import { Chip } from "@/components/ui/chip"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useExitNodeStates } from "@/hooks/use-exit-node-states"
import { useIsMobile } from "@/hooks/use-mobile"
import { deviceDisplayName } from "@/lib/device-status"
import { retryableQuery } from "@/lib/query-retry"
import { firstTopologyNode } from "@/lib/topology-layout"
import { cn } from "@/lib/utils"
import { applyRealtimeEvent } from "@/realtime/apply-event"
import { useEventStream } from "@/realtime/use-event-stream"

import "@xyflow/react/dist/style.css"

export function NetworkMapPage({ networkId }: { networkId: string }) {
  return (
    <NetworkShell networkId={networkId} tab="map">
      {(data) => <MapTab data={data} />}
    </NetworkShell>
  )
}

function MapTab({ data }: { data: NetworkShellData }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const networkId = data.network.id
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const isCompact = useIsMobile(1100)
  const isPhone = useIsMobile(640)

  const exitNodeByDeviceId = useExitNodeStates(networkId)
  // Same query the shell uses; this observer adds the shared retry policy and
  // gives the page an error state so a 500 is not silently swallowed.
  const routesQuery = useListNetworkRoutes(networkId, { query: retryableQuery })
  const topologyQuery = useGetNetworkTopology(networkId)
  const snapshot = topologyQuery.data?.data
  useEventStream({
    networkId,
    topology: true,
    enabled: true,
    onEvent: (event) => applyRealtimeEvent(queryClient, event),
  })

  const deviceById = useMemo(
    () => new Map(data.devices.map((device) => [device.id, device])),
    [data.devices]
  )
  const deviceOsById = useMemo(() => {
    const map: Record<string, ListDevices200Item["os"]> = {}
    for (const device of data.devices) map[device.id] = device.os
    return map
  }, [data.devices])

  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot])
  const links = useMemo(() => snapshot?.links ?? [], [snapshot])
  // The default panel is the first node in stable name+id order. Picking
  // `nodes[0]` meant a reordered snapshot silently switched the panel to a
  // different device; an explicit selection wins as long as it still exists.
  const defaultNode = useMemo(() => firstTopologyNode(nodes), [nodes])
  const selectedNode = useMemo(() => {
    if (selectedNodeId) {
      const explicit = nodes.find((node) => node.id === selectedNodeId)
      if (explicit) return explicit
    }
    return defaultNode
  }, [nodes, selectedNodeId, defaultNode])
  const selectedLinks = useMemo(
    () =>
      selectedNode
        ? links.filter(
            (link) =>
              link.source === selectedNode.id || link.target === selectedNode.id
          )
        : [],
    [links, selectedNode]
  )
  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    void getNetworkTopology(networkId, { refresh: "1" })
      .then((response) => {
        queryClient.setQueryData(
          getGetNetworkTopologyQueryKey(networkId),
          response
        )
      })
      .catch(() => undefined)
      .finally(() => setRefreshing(false))
  }

  if (topologyQuery.isLoading) {
    return <Skeleton className="h-[60vh] w-full rounded-xl" />
  }

  if (topologyQuery.isError) {
    return (
      <RouteLoadError
        message={t("map.loadError")}
        onRetry={() => void topologyQuery.refetch()}
        pending={topologyQuery.isFetching}
      />
    )
  }

  if (!snapshot || nodes.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RadioTowerIcon />
          </EmptyMedia>
          <EmptyTitle>{t("topology.title")}</EmptyTitle>
          <EmptyDescription>{t("topology.empty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const panel = selectedNode ? (
    <MapSidePanel
      device={
        selectedNode.deviceId
          ? deviceById.get(selectedNode.deviceId)
          : undefined
      }
      links={selectedLinks}
      networkId={networkId}
      node={selectedNode}
      nodes={nodes}
      onClose={isCompact ? () => setSelectedNodeId(null) : undefined}
    />
  ) : null

  const showNatHint = !snapshot.stats.hasReachableNode && !hintDismissed

  return (
    <div className="flex flex-col gap-4">
      {routesQuery.isError ? (
        <RouteLoadError
          onRetry={() => void routesQuery.refetch()}
          pending={routesQuery.isFetching}
        />
      ) : null}

      {showNatHint ? (
        <div className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 ring-1 ring-warn-line">
          <AlertTriangleIcon
            aria-hidden="true"
            className="mt-0.5 size-4 flex-none text-warn"
          />
          <p className="min-w-0 flex-1 text-[13px] text-fg-2">
            {snapshot.stats.relayCapableNodes > 0
              ? t("map.natHintRelayed", {
                  count: snapshot.stats.relayCapableNodes,
                })
              : t("map.natHint")}
          </p>
          <button
            aria-label={t("map.dismissHint")}
            className="grid size-7 flex-none cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setHintDismissed(true)}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
        <section
          aria-label={t("topology.title")}
          className="min-w-0 flex-1 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
            <div className="hidden flex-1 flex-wrap items-center gap-3 text-xs text-fg-2 sm:flex">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0.5 w-5 bg-ok-dot" />
                {t("topology.direct")}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-0.5 w-5 bg-warn"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(90deg, var(--warn) 0 4px, transparent 4px 7px)",
                  }}
                />
                {t("topology.relayed")}
              </span>
              <span className="flex items-center gap-1.5">
                <RadioTowerIcon
                  aria-hidden="true"
                  className="size-3.5 text-relay"
                />
                {t("map.legend.relayCapable")}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      aria-label={t("map.legend.title")}
                      className="grid size-6 cursor-pointer place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      type="button"
                    />
                  }
                >
                  <InfoIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-pretty">
                  {t("map.legend.hint")}
                </TooltipContent>
              </Tooltip>
            </div>
            <span className="hidden text-xs text-fg-3 md:inline">
              {t("map.updated", {
                time: new Date(snapshot.collectedAt).toLocaleTimeString(),
              })}
            </span>
            <LiveStatus />
            <Button
              aria-label={t("common.refresh")}
              disabled={refreshing}
              onClick={refresh}
              size="icon-sm"
              variant="ghost"
            >
              <RefreshCwIcon className="size-4" />
            </Button>
          </div>
          {isPhone ? (
            <div
              className="flex items-center justify-center p-2"
              style={{
                backgroundImage:
                  "radial-gradient(var(--line) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            >
              <CompactTopologyMap
                deviceOsById={deviceOsById}
                key={networkId}
                links={links}
                nodes={nodes}
                onSelectNode={setSelectedNodeId}
                selectedNodeId={selectedNode?.id ?? null}
              />
            </div>
          ) : (
            <div className="h-[440px] p-2 sm:h-[520px] xl:h-[600px]">
              <TopologyMap
                className="h-full min-h-0 rounded-none border-0"
                deviceOsById={deviceOsById}
                key={networkId}
                links={links}
                exitNodeByDeviceId={exitNodeByDeviceId}
                minimap={false}
                nodes={nodes}
                pingLabels
                slim
                onSelectNode={setSelectedNodeId}
                selectedNodeId={selectedNode?.id ?? null}
              />
            </div>
          )}
        </section>

        {!isCompact ? (
          <aside
            aria-label={t("topology.deviceDrawer")}
            className="flex xl:w-[340px] xl:flex-none"
          >
            {panel}
          </aside>
        ) : null}
      </div>

      {snapshot.stats.failedObservations > 0 ? (
        <p className="text-xs text-warn">
          {t("topology.partial", { count: snapshot.stats.failedObservations })}
        </p>
      ) : null}

      {isCompact ? (
        <Sheet
          onOpenChange={(open) => {
            if (!open) setSelectedNodeId(null)
          }}
          open={Boolean(selectedNode) && Boolean(selectedNodeId)}
        >
          <SheetContent
            className="max-h-[85dvh] overflow-y-auto rounded-t-2xl data-[side=bottom]:rounded-t-2xl"
            showCloseButton={false}
            side="bottom"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>
                {selectedNode?.hostname ?? t("topology.deviceDrawer")}
              </SheetTitle>
            </SheetHeader>
            <div
              aria-hidden="true"
              className="mx-auto h-[5px] w-10 flex-none rounded-full bg-line-2"
            />
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}

function MapSidePanel({
  node,
  nodes,
  device,
  links,
  networkId,
  onClose,
}: {
  node: TopologyNode
  nodes: TopologyNode[]
  device?: ListDevices200Item
  links: TopologyLink[]
  networkId: string
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const byId = useMemo(
    () => new Map(nodes.map((entry) => [entry.id, entry.hostname || entry.id])),
    [nodes]
  )
  const name = device ? deviceDisplayName(device) : node.hostname || node.id

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex items-start gap-3 border-b border-line px-4 py-4">
        <span className="grid size-11 flex-none place-items-center rounded-xl bg-surface-2 text-fg-2 ring-1 ring-line">
          {device ? (
            <DeviceIcon className="size-5" os={device.os} />
          ) : (
            <ServerIcon aria-hidden="true" className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base leading-6 font-semibold tracking-[-0.006em]">
              {name}
            </h2>
            {device?.isHub ? (
              <Chip>
                <RadioTowerIcon aria-hidden="true" className="size-3" />
                {t("devices.detail.hub.badge")}
              </Chip>
            ) : null}
            {node.relayCapable ? (
              <Chip variant="relay">{t("topology.relayCapable")}</Chip>
            ) : null}
          </div>
          {device?.description ? (
            <p
              className="mt-1 max-w-full truncate text-[13px] leading-5 text-fg-3"
              title={device.description}
            >
              {device.description}
            </p>
          ) : null}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
            {device ? (
              <DeviceStatusCell device={device} />
            ) : (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={
                    node.online
                      ? "size-2 rounded-full bg-ok-dot"
                      : "size-2 rounded-full bg-fg-3/50"
                  }
                />
                {node.online
                  ? t("deviceStatus.labels.online")
                  : t("deviceStatus.labels.offline")}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              {node.virtualIpv4 ?? t("common.none")}
            </span>
          </div>
        </div>
        {onClose ? (
          <Button
            aria-label={t("common.close")}
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>

      <dl className="px-4 text-sm">
        <Detail label={t("topology.natType")}>{node.natType}</Detail>
        <Detail label={t("topology.publicIps")} mono>
          {node.publicIps.length === 0 ? (
            t("common.none")
          ) : (
            <span className="flex flex-col gap-0.5">
              {node.publicIps.map((ip) => (
                <CopyableValue key={ip} value={ip} />
              ))}
            </span>
          )}
        </Detail>
        <Detail label={t("topology.relaysFor")}>
          {node.relaysFor.map((id) => byId.get(id) ?? id).join(", ") ||
            t("common.none")}
        </Detail>
        <Detail label={t("devices.version")} mono>
          {node.version || device?.easytierVersion || t("common.none")}
        </Detail>
      </dl>

      <p className="px-4 pt-3 pb-1.5 text-xs leading-4 font-medium tracking-wide text-fg-2 uppercase">
        {t("topology.connections")}
      </p>
      <div className="min-h-0 flex-1">
        {links.length === 0 ? (
          <p className="px-4 pb-3 text-[13px] text-fg-3">{t("common.empty")}</p>
        ) : (
          links.map((link) => {
            const otherId = link.source === node.id ? link.target : link.source
            const otherName = byId.get(otherId) ?? otherId
            return (
              <div
                className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-2"
                key={link.id}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {otherName}
                </span>
                <Chip variant={link.kind === "direct" ? "ok" : "warn"}>
                  {link.kind === "direct"
                    ? t("topology.direct")
                    : t("topology.relayed")}
                </Chip>
                <span className="min-w-[4.5rem] text-right font-mono text-xs whitespace-nowrap text-fg-3 tabular-nums">
                  {link.latencyMs !== null
                    ? `${link.latencyMs} ms`
                    : t("common.none")}
                </span>
              </div>
            )
          })
        )}
      </div>

      <div className="p-4 pt-3">
        {node.deviceId ? (
          <LinkButton
            className="w-full"
            href={`/devices/${node.deviceId}`}
            variant="outline"
          >
            {t("topology.openDevice")}
            <ArrowRightIcon className="size-4" />
          </LinkButton>
        ) : (
          <LinkButton
            className="w-full"
            href={`/networks/${networkId}`}
            variant="outline"
          >
            {t("deviceDrawer.openNetwork")}
            <ArrowRightIcon className="size-4" />
          </LinkButton>
        )}
      </div>
    </div>
  )
}

/**
 * One row of the detail list. `dl > div` groups are valid HTML and keep the
 * first row's top border off both the label and the value, which the previous
 * `first:border-t-0` did only for the label and left a half-line.
 */
function Detail({
  label,
  mono,
  children,
}: {
  label: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-t border-line py-2 first:border-t-0 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <dt className="text-xs leading-5 text-fg-3 sm:text-[13px]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-[13px] leading-5 break-words",
          mono && "font-mono text-xs"
        )}
        title={typeof children === "string" ? children : undefined}
      >
        {children}
      </dd>
    </div>
  )
}

/** A public IP that can be read in full, copied and wrapped instead of cut. */
function CopyableValue({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is unavailable on insecure origins; the value stays visible.
    }
  }

  return (
    <button
      aria-label={`${t("common.copy")}: ${value}`}
      className="group -mx-1 flex min-h-11 min-w-0 cursor-pointer items-start gap-1.5 rounded-md px-1 py-0.5 text-left font-mono text-xs break-all text-fg-2 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-0"
      onClick={() => void copy()}
      title={value}
      type="button"
    >
      <span className="min-w-0">{value}</span>
      {copied ? (
        <CheckIcon
          aria-hidden="true"
          className="mt-0.5 size-3.5 flex-none text-ok"
        />
      ) : (
        <CopyIcon
          aria-hidden="true"
          className="mt-0.5 size-3.5 flex-none text-fg-3 group-hover:text-foreground"
        />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? t("common.copied") : ""}
      </span>
    </button>
  )
}
