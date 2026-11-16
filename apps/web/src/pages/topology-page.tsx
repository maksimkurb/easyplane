import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import {
  AlertTriangleIcon,
  InfoIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  WaypointsIcon,
} from "lucide-react"

import { useQueryClient } from "@tanstack/react-query"

import {
  getGetNetworkTopologyQueryKey,
  getNetworkTopology,
  useGetNetworkTopology,
  useListNetworks,
} from "@/api/generated/easyplane"
import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
} from "@/api/generated/model"
import { DeviceDrawer } from "@/components/topology/device-drawer"
import { TopologyMap } from "@/components/topology/topology-map"
import { OptionSelect } from "@/components/shared/option-select"
import { PageContainer } from "@/components/layout/page-container"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { applyRealtimeEvent } from "@/realtime/apply-event"
import { useExitNodeStates } from "@/hooks/use-exit-node-states"
import { useEventStream } from "@/realtime/use-event-stream"
import { cn } from "@/lib/utils"

import "@xyflow/react/dist/style.css"

/**
 * Live connectivity map.
 *
 * The map opens a second SSE stream (the shell has one already) with
 * `topology=1`, which is what tells the server to collect faster while a human
 * is looking at it. Events are applied to the shared query cache by the shell
 * stream, so this page only uses its stream for status and interest.
 */
export function TopologyPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const networksQuery = useListNetworks()
  const networks = useMemo(() => networksQuery.data?.data ?? [], [networksQuery.data])
  // Deep link: /topology?network=<uuid>. The first network is the fallback, so
  // no effect has to seed the selection.
  const [requestedNetworkId] = useState(
    () => new URLSearchParams(window.location.search).get("network") ?? ""
  )
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null)
  const networkId = selectedNetworkId ?? requestedNetworkId ?? networks[0]?.id ?? ""
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const now = useNow(15_000)

  const topologyQuery = useGetNetworkTopology(networkId || "", undefined, {
    query: { enabled: Boolean(networkId) },
  })
  const exitNodeByDeviceId = useExitNodeStates(networkId)
  const snapshot = topologyQuery.data?.data
  const stream = useEventStream({
    networkId: networkId || undefined,
    topology: true,
    enabled: Boolean(networkId),
    // Topology snapshots are delivered only to map streams; everything else
    // arrives through the shell stream.
    onEvent: (event) => applyRealtimeEvent(queryClient, event),
  })

  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot])
  const links = useMemo(() => snapshot?.links ?? [], [snapshot])
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )
  const selectedObservation = useMemo(() => {
    if (!selectedNode?.deviceId) return null
    return (
      snapshot?.observations.find(
        (observation) => observation.deviceId === selectedNode.deviceId
      ) ?? null
    )
  }, [selectedNode, snapshot])
  const selectedLinks = useMemo(
    () =>
      selectedNode
        ? links.filter(
            (link) => link.source === selectedNode.id || link.target === selectedNode.id
          )
        : [],
    [links, selectedNode]
  )
  const selectedLink = useMemo(
    () => links.find((link) => link.id === selectedLinkId) ?? null,
    [links, selectedLinkId]
  )

  const network = networks.find((entry) => entry.id === networkId)
  const stale =
    snapshot?.collectedAt !== undefined &&
    now - Date.parse(snapshot.collectedAt) > 60_000

  return (
    <PageContainer className="py-6 sm:py-8">
      <>
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OptionSelect
              aria-label={t("networks.title")}
              className="w-full sm:w-56"
              empty={
                networksQuery.isLoading ? undefined : (
                  <>
                    {t("topology.noNetworks")}{" "}
                    <Link href="/networks">{t("nav.items.networks")}</Link>
                  </>
                )
              }
              onValueChange={(value) => {
                setSelectedNetworkId(value)
                setSelectedNodeId(null)
                setSelectedLinkId(null)
              }}
              options={networks.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
              triggerClassName="sm:max-w-none"
              value={networkId}
            />
            <Button
              disabled={!networkId || refreshing}
              onClick={() => {
                if (!networkId || refreshing) return
                // Force a real probe instead of reusing the cached snapshot.
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
              }}
              size="sm"
              variant="outline"
            >
              <RefreshCwIcon className="size-4" />
              {t("common.refresh")}
            </Button>
            <LiveBadge status={stream.status} />
          </div>
        }
        description={t("topology.description")}
        title={
          <span className="flex items-center gap-2">
            <WaypointsIcon className="size-5" />
            {t("topology.title")}
          </span>
        }
      />

      <div className="grid gap-4">
        {networks.length === 0 && !networksQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("networks.empty")}</p>
        ) : null}

        {snapshot && !snapshot.stats.hasReachableNode ? (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>{t("topology.noReachableTitle")}</AlertTitle>
            <AlertDescription>
              {snapshot.stats.relayCapableNodes > 0
                ? t("topology.noReachableRelayed", {
                    count: snapshot.stats.relayCapableNodes,
                  })
                : t("topology.noReachableHint")}
            </AlertDescription>
          </Alert>
        ) : null}

        {network ? (
          <SectionCard
            action={<Legend snapshotStats={snapshot?.stats} />}
            description={
              snapshot
                ? t("topology.collectedAt", {
                    time: new Date(snapshot.collectedAt).toLocaleTimeString(),
                    interval: Math.round(snapshot.intervalMs / 1000),
                  })
                : undefined
            }
            title={`${network.name}${stale ? ` · ${t("topology.stale")}` : ""}`}
          >
            {topologyQuery.isLoading ? (
              <Skeleton className="h-[60vh] w-full" />
            ) : !snapshot || nodes.length === 0 ? (
              <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <WaypointsIcon className="size-8" />
                <p>{t("topology.empty")}</p>
              </div>
            ) : (
              <div className="grid gap-3">
                <TopologyMap
                  key={networkId}
                  exitNodeByDeviceId={exitNodeByDeviceId}
                  links={links}
                  nodes={nodes}
                  onSelectLink={setSelectedLinkId}
                  onSelectNode={setSelectedNodeId}
                  selectedNodeId={selectedNodeId}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <InfoIcon className="size-3.5" />
                  <span>{t("topology.honestNote")}</span>
                </div>
                {selectedLink ? (
                  <LinkDetails
                    link={selectedLink}
                    nodes={nodes}
                    onClose={() => setSelectedLinkId(null)}
                  />
                ) : null}
              </div>
            )}
          </SectionCard>
        ) : null}

        {snapshot && snapshot.stats.failedObservations > 0 ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("topology.partial", { count: snapshot.stats.failedObservations })}
          </p>
        ) : null}
      </div>

      <DeviceDrawer
        links={selectedLinks}
        nodes={nodes}
        observation={selectedObservation}
        onOpenChange={(open) => {
          if (!open) setSelectedNodeId(null)
        }}
        open={Boolean(selectedNode)}
        node={selectedNode}
      />
      </>
    </PageContainer>
  )
}

/** Re-renders on an interval so relative labels (stale/collected) stay honest. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function LiveBadge({ status }: { status: ReturnType<typeof useEventStream>["status"] }) {
  const { t } = useTranslation()
  return (
    <Badge className="gap-1.5" variant="outline">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "live"
            ? "bg-emerald-500"
            : status === "connecting" || status === "reconnecting"
              ? "bg-amber-500"
              : "bg-muted-foreground/50"
        )}
      />
      {t(`realtime.status.${status}`)}
    </Badge>
  )
}

function Legend({
  snapshotStats,
}: {
  snapshotStats?: {
    directLinks: number
    relayedLinks: number
    relayCapableNodes: number
    nodes: number
  }
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-0.5 w-6 bg-emerald-500" />
        {t("topology.direct")} {snapshotStats ? `(${snapshotStats.directLinks})` : null}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-0.5 w-6 bg-amber-500"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, rgb(245 158 11) 0 4px, transparent 4px 7px)" }}
        />
        {t("topology.relayed")} {snapshotStats ? `(${snapshotStats.relayedLinks})` : null}
      </span>
      <span className="flex items-center gap-1.5">
        <RadioTowerIcon className="size-3.5 text-violet-500" />
        {t("topology.relayCapable")}{" "}
        {snapshotStats ? `(${snapshotStats.relayCapableNodes})` : null}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-emerald-500" />
        {t("devices.status.online")}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-muted-foreground/50" />
        {t("devices.status.offline")}
      </span>
    </div>
  )
}

function LinkDetails({
  link,
  nodes,
  onClose,
}: {
  link: TopologyLink
  nodes: TopologyNode[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">
          {byId.get(link.source)?.hostname ?? link.source} ↔{" "}
          {byId.get(link.target)?.hostname ?? link.target}
        </p>
        <Button onClick={onClose} size="sm" variant="ghost">
          {t("common.close")}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label={t("topology.kind")} value={link.kind} />
        <Detail label={t("topology.tunnel")} value={link.rawTunnelType || link.protocol} />
        <Detail
          label={t("topology.latency")}
          value={link.latencyMs !== null ? `${link.latencyMs} ms` : t("common.none")}
        />
        <Detail
          label={t("topology.loss")}
          value={
            link.lossPercent !== null ? `${link.lossPercent}%` : t("common.none")
          }
        />
        <Detail
          label={t("topology.hops")}
          value={link.cost !== null ? String(link.cost) : t("common.none")}
        />
        <Detail
          label={t("topology.pathLatency")}
          value={
            link.pathLatencyMs !== null ? `${link.pathLatencyMs} ms` : t("common.none")
          }
        />
        <Detail
          label={t("topology.relay")}
          value={link.viaHostname ?? t("common.none")}
        />
        <Detail
          label={t("topology.direction")}
          value={
            link.direction === "unknown"
              ? t("common.none")
              : t(`topology.${link.direction}`)
          }
        />
        <Detail
          label={t("topology.observedBy")}
          value={link.observedBy
            .map((id) => byId.get(id)?.hostname ?? id)
            .join(", ")}
        />
      </div>
      {link.asymmetric ? (
        <p className="mt-2 text-amber-600 dark:text-amber-400">
          {t("topology.asymmetric")}
        </p>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">
          {t("topology.evidence")}
        </summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2 text-[10px]">
          {JSON.stringify(link.evidence, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono break-all">{value}</p>
    </div>
  )
}
