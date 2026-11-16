import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  InfoIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import {
  getGetNetworkTopologyQueryKey,
  getNetworkTopology,
  useGetNetworkTopology,
} from "@/api/generated/easyplane"
import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
} from "@/api/generated/model"
import { NetworkShell, type NetworkShellData } from "@/components/network/network-shell"
import { CompactTopologyMap } from "@/components/topology/compact-topology-map"
import { TopologyMap } from "@/components/topology/topology-map"
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
import { useExitNodeStates } from "@/hooks/use-exit-node-states"
import { useIsMobile } from "@/hooks/use-mobile"
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
  const isCompact = useIsMobile(1100)
  const isPhone = useIsMobile(640)

  const exitNodeByDeviceId = useExitNodeStates(networkId)
  const topologyQuery = useGetNetworkTopology(networkId)
  const snapshot = topologyQuery.data?.data
  const stream = useEventStream({
    networkId,
    topology: true,
    enabled: true,
    onEvent: (event) => applyRealtimeEvent(queryClient, event),
  })

  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot])
  const links = useMemo(() => snapshot?.links ?? [], [snapshot])
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId]
  )
  const selectedLinks = useMemo(
    () =>
      selectedNode
        ? links.filter(
            (link) => link.source === selectedNode.id || link.target === selectedNode.id
          )
        : [],
    [links, selectedNode]
  )
  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    void getNetworkTopology(networkId, { refresh: "1" })
      .then((response) => {
        queryClient.setQueryData(getGetNetworkTopologyQueryKey(networkId), response)
      })
      .catch(() => undefined)
      .finally(() => setRefreshing(false))
  }

  if (topologyQuery.isLoading) {
    return <Skeleton className="h-[60vh] w-full rounded-xl" />
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
      devices={data.devices}
      links={selectedLinks}
      networkId={networkId}
      node={selectedNode}
      nodes={nodes}
      onClose={isCompact ? () => setSelectedNodeId(null) : undefined}
    />
  ) : null

  return (
    <div className="flex flex-col gap-4">
      {!snapshot.stats.hasReachableNode ? (
        <div className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-3 ring-1 ring-warn-line">
          <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 flex-none text-warn" />
          <div className="min-w-0 text-[13px]">
            <p className="font-medium text-warn">{t("topology.noReachableTitle")}</p>
            <p className="mt-0.5 text-fg-2">
              {snapshot.stats.relayCapableNodes > 0
                ? t("topology.noReachableRelayed", {
                    count: snapshot.stats.relayCapableNodes,
                  })
                : t("topology.noReachableHint")}
            </p>
          </div>
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
                <RadioTowerIcon aria-hidden="true" className="size-3.5 text-relay" />
                {t("topology.relayCapable")}
              </span>
            </div>
            <span className="hidden text-xs text-fg-3 sm:inline">
              {t("topology.collectedAt", {
                time: new Date(snapshot.collectedAt).toLocaleTimeString(),
                interval: Math.round(snapshot.intervalMs / 1000),
              })}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-fg-2">
              <span
                aria-hidden="true"
                className={
                  stream.status === "live"
                    ? "size-2 rounded-full bg-ok-dot ring-3 ring-ok-soft"
                    : "size-2 rounded-full bg-fg-3/50"
                }
              />
              {t(`realtime.status.${stream.status}`)}
            </span>
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
              className="flex h-[460px] items-center justify-center p-2"
              style={{
                backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            >
              <CompactTopologyMap
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
          <div className="flex flex-wrap items-start gap-2 border-t border-line px-4 py-2.5 text-xs text-fg-3">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 flex-none" />
            <span>{t("topology.honestNote")}</span>
          </div>
        </section>

        {!isCompact ? (
          <aside aria-label={t("topology.deviceDrawer")} className="flex xl:w-[340px] xl:flex-none">
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
            side="bottom"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{selectedNode?.hostname ?? t("topology.deviceDrawer")}</SheetTitle>
            </SheetHeader>
            <div aria-hidden="true" className="mx-auto h-[5px] w-10 flex-none rounded-full bg-line-2" />
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
  links,
  devices,
  networkId,
  onClose,
}: {
  node: TopologyNode
  nodes: TopologyNode[]
  links: TopologyLink[]
  devices: NetworkShellData["devices"]
  networkId: string
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const byId = useMemo(() => new Map(nodes.map((entry) => [entry.id, entry])), [nodes])
  const device = node.deviceId
    ? devices.find((entry) => entry.id === node.deviceId)
    : undefined

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
      <div className="flex items-start gap-3 border-b border-line px-4 py-4">
        <span className="grid size-11 flex-none place-items-center rounded-xl bg-surface-2 text-fg-2 ring-1 ring-line">
          <RadioTowerIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base leading-6 font-semibold tracking-[-0.006em]">
              {node.hostname || node.id}
            </h2>
            {device?.isHub ? <Chip variant="brand">{t("devices.detail.hub.badge")}</Chip> : null}
            {node.relayCapable ? <Chip variant="relay">{t("topology.relayCapable")}</Chip> : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={
                  node.online ? "size-2 rounded-full bg-ok-dot" : "size-2 rounded-full bg-fg-3/50"
                }
              />
              {node.online ? t("devices.status.online") : t("devices.status.offline")}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{node.virtualIpv4 ?? t("common.none")}</span>
          </p>
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

      <dl className="grid grid-cols-[110px_minmax(0,1fr)] px-4 text-sm">
        <Detail label={t("topology.natType")} value={node.natType} />
        <Detail
          label={t("topology.publicIps")}
          mono
          value={node.publicIps.join(", ") || t("common.none")}
        />
        <Detail
          label={t("topology.relaysFor")}
          value={
            node.relaysFor.map((id) => byId.get(id)?.hostname ?? id).join(", ") ||
            t("common.none")
          }
        />
        <Detail label={t("devices.version")} mono value={node.version || t("common.none")} />
      </dl>

      <p className="px-4 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">
        {t("topology.connections")}
      </p>
      <div className="min-h-0 flex-1">
        {links.length === 0 ? (
          <p className="px-4 pb-3 text-[13px] text-fg-3">{t("common.empty")}</p>
        ) : (
          links.map((link) => {
            const other = byId.get(link.source === node.id ? link.target : link.source)
            return (
              <div
                className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-2"
                key={link.id}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {other?.hostname ?? link.target}
                </span>
                <Chip variant={link.kind === "direct" ? "ok" : "warn"}>
                  {link.kind === "direct" ? t("topology.direct") : t("topology.relayed")}
                </Chip>
                <span className="w-14 text-right font-mono text-xs text-fg-3">
                  {link.latencyMs !== null ? `${link.latencyMs} ms` : t("common.none")}
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

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <>
      <dt className="flex min-h-10 items-center border-t border-line py-2 text-[13px] text-fg-3 first:border-t-0">
        {label}
      </dt>
      <dd
        className={`flex min-h-10 min-w-0 items-center border-t border-line py-2 text-[13px] first:border-t-0 ${
          mono ? "truncate font-mono text-xs" : "truncate"
        }`}
      >
        {value}
      </dd>
    </>
  )
}
