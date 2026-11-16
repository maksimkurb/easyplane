import { useCallback, useMemo, useState } from "react"
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getStraightPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type InternalNode,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnNodesChange,
  type NodeChange,
} from "@xyflow/react"
import { useTranslation } from "react-i18next"
import { RadioTowerIcon, ServerIcon } from "lucide-react"

import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
} from "@/api/generated/model"
import { ExitNodeBadge, type ExitNodeState } from "@/components/exit-node-badge"
import { Badge } from "@/components/ui/badge"
import { layoutTopology } from "@/lib/topology-layout"
import { cn } from "@/lib/utils"

type DeviceNodeData = {
  node: TopologyNode
  exitNode?: ExitNodeState
  compact?: boolean
  slim?: boolean
}

const nodeTypes: NodeTypes = { device: DeviceNode }

/** Point where the line from `node`'s centre to `other`'s centre leaves `node`'s box. */
function borderPoint(node: InternalNode, other: InternalNode) {
  const w = (node.measured.width ?? 0) / 2
  const h = (node.measured.height ?? 0) / 2
  const cx = node.internals.positionAbsolute.x + w
  const cy = node.internals.positionAbsolute.y + h
  const ox = other.internals.positionAbsolute.x + (other.measured.width ?? 0) / 2
  const oy = other.internals.positionAbsolute.y + (other.measured.height ?? 0) / 2
  const dx = ox - cx
  const dy = oy - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  // Scale the direction vector until it touches the rectangle edge.
  const scale = 1 / Math.max(Math.abs(dx) / (w || 1), Math.abs(dy) / (h || 1))
  return { x: cx + dx * scale, y: cy + dy * scale }
}

/**
 * Straight line between two device cards, clipped to the card borders. React
 * Flow's default edges leave from fixed left/right handles, which loops lines
 * around the cards when the peer sits on the other side.
 */
function DirectEdge({
  id,
  source,
  target,
  style,
  label,
  labelStyle,
  labelBgStyle,
}: EdgeProps) {
  const from = useInternalNode(source)
  const to = useInternalNode(target)
  if (!from || !to) return null
  const a = borderPoint(from, to)
  const b = borderPoint(to, from)
  const [path, labelX, labelY] = getStraightPath({
    sourceX: a.x,
    sourceY: a.y,
    targetX: b.x,
    targetY: b.y,
  })
  return (
    <>
      <BaseEdge id={id} interactionWidth={16} path={path} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded px-1 py-0.5 text-[10px] leading-3"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "var(--card)",
              opacity: (labelBgStyle as { fillOpacity?: number } | undefined)?.fillOpacity ?? 0.9,
              ...(labelStyle as object),
              fill: undefined,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

const edgeTypes: EdgeTypes = { direct: DirectEdge }

/**
 * One device card. Relay-capable nodes get a violet ring and a tower badge;
 * offline nodes are muted. The card carries a native tooltip with the fields
 * the map cannot fit, and clicking opens the detail drawer.
 */
export function TopologyNodeCard({
  node,
  exitNode = "none",
  selected,
  compact = false,
  slim = false,
}: {
  node: TopologyNode
  exitNode?: ExitNodeState
  selected: boolean
  compact?: boolean
  slim?: boolean
}) {
  const { t } = useTranslation()
  if (slim) {
    return (
      <div
        className={cn(
          "relative w-[170px] rounded-xl bg-card px-2 py-1.5 shadow-sm transition-shadow",
          node.online
            ? "ring-1 ring-line-2"
            : "opacity-70 outline outline-1 outline-dashed outline-line-2",
          selected && "shadow-md ring-2 ring-brand"
        )}
        title={[node.hostname, node.virtualIpv4, node.natType].filter(Boolean).join(" · ")}
      >
        <Handle className="!opacity-0" position={Position.Left} type="target" />
        <Handle className="!opacity-0" position={Position.Right} type="source" />
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative grid size-9 flex-none place-items-center rounded-[9px] bg-surface-2 text-fg-2 ring-1 ring-line">
            <ServerIcon aria-hidden="true" className="size-4" />
            <span
              aria-hidden="true"
              className={cn(
                "absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-card",
                node.online ? "bg-ok-dot" : "bg-fg-3"
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-4 font-semibold">
              {node.hostname || node.id}
            </span>
            <span className="block truncate font-mono text-[11.5px] leading-4 text-fg-3">
              {node.virtualIpv4 ?? t("common.none")}
            </span>
          </span>
          {node.relayCapable ? (
            <span
              className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-relay text-white ring-2 ring-card"
              title={t("topology.relayCapable")}
            >
              <RadioTowerIcon aria-hidden="true" className="size-3" />
            </span>
          ) : null}
        </div>
        {exitNode !== "none" ? (
          <span className="absolute -bottom-2 left-2 bg-card">
            <ExitNodeBadge className="px-1.5 py-0 text-[9px]" state={exitNode} />
          </span>
        ) : null}
      </div>
    )
  }

  const tooltip = [
    node.hostname,
    node.virtualIpv4 ? `IP ${node.virtualIpv4}` : null,
    `NAT ${node.natType}${node.tcpNatType !== "Unknown" ? ` (tcp ${node.tcpNatType})` : ""}`,
    node.publicIps.length > 0 ? `Public ${node.publicIps.join(", ")}` : null,
    node.version ? `EasyTier ${node.version}` : null,
    node.relaysFor.length > 0 ? `Relays for ${node.relaysFor.length} node(s)` : null,
    node.listeners.length > 0 ? `Listeners ${node.listeners.join(" ")}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-shadow",
        compact ? "w-[136px] px-2.5 py-1.5" : "w-[180px] px-3 py-2",
        node.online ? "border-border" : "border-dashed border-muted-foreground/40 opacity-70",
        node.relayCapable && "border-violet-500/70 ring-1 ring-violet-500/40",
        selected && "shadow-md ring-2 ring-primary"
      )}
      title={tooltip}
    >
      <Handle className="!opacity-0" position={Position.Left} type="target" />
      <Handle className="!opacity-0" position={Position.Right} type="source" />
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            node.online ? "bg-emerald-500" : "bg-muted-foreground/50"
          )}
        />
        <span className="truncate text-xs font-semibold">
          {node.hostname || node.id}
        </span>
        {node.relayCapable ? (
          <RadioTowerIcon
            aria-label={t("topology.relayCapable")}
            className="ml-auto size-3.5 shrink-0 text-violet-500"
          />
        ) : null}
      </div>
      {!compact ? (
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          {node.virtualIpv4 ?? t("common.none")}
          {node.peerId ? ` · #${node.peerId}` : ""}
        </div>
      ) : null}
      {!compact ? (
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge className="px-1.5 py-0 text-[9px]" variant="outline">
          {node.natType}
        </Badge>
        {node.managed ? (
          <Badge className="px-1.5 py-0 text-[9px]" variant="outline">
            {t("topology.managed")}
          </Badge>
        ) : (
          <Badge className="border-amber-500/40 px-1.5 py-0 text-[9px] text-amber-700 dark:text-amber-300" variant="outline">
            {t("topology.unmanaged")}
          </Badge>
        )}
        <ExitNodeBadge className="px-1.5 py-0 text-[9px]" state={exitNode} />
        {node.relaysFor.length > 0 ? (
          <Badge className="border-violet-500/40 px-1.5 py-0 text-[9px] text-violet-700 dark:text-violet-300" variant="outline">
            {t("topology.relayCount", { count: node.relaysFor.length })}
          </Badge>
        ) : null}
      </div>
      ) : null}
    </div>
  )
}

function DeviceNode({ data, selected }: NodeProps<Node<DeviceNodeData, "device">>) {
  return (
    <TopologyNodeCard
      compact={data.compact}
      exitNode={data.exitNode}
      node={data.node}
      selected={Boolean(selected)}
      slim={data.slim}
    />
  )
}

export interface TopologyMapProps {
  nodes: TopologyNode[]
  links: TopologyLink[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onSelectLink?: (linkId: string | null) => void
  /** Height comes from the page; the map fills whatever box it is given. */
  className?: string
  /** The network map uses the side panel instead of a minimap. */
  minimap?: boolean
  /** Short latency labels (design "ping pills") instead of full edge text. */
  pingLabels?: boolean
  /** Phones: smaller cards with only the hostname, status and relay mark. */
  compact?: boolean
  /** Network map: the design's 52px node card (name, address, relay mark). */
  slim?: boolean
  /** Exit-node badge per device id (declared proposals from the routes API). */
  exitNodeByDeviceId?: Record<string, ExitNodeState>
}

/** Renders the derived snapshot as a React Flow graph. */
export function TopologyMap({
  nodes,
  links,
  selectedNodeId,
  onSelectNode,
  onSelectLink,
  className,
  minimap = true,
  pingLabels = false,
  compact = false,
  slim = false,
  exitNodeByDeviceId,
}: TopologyMapProps) {
  const { t } = useTranslation()
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({})

  const positions = useMemo(
    () =>
      layoutTopology(
        nodes.map((node) => ({
          id: node.id,
          label: node.hostname,
          relayCapable: node.relayCapable,
          online: node.online,
        })),
        links,
        compact
          ? {
              baseRadius: 150,
              ringGap: 170,
              minSpacing: 150,
              nodeWidth: 120,
            }
          : undefined
      ),
    [nodes, links, compact]
  )

  const flowNodes = useMemo<Node<DeviceNodeData, "device">[]>(
    () =>
      nodes.map((node) => {
        const position = overrides[node.id] ?? positions.get(node.id) ?? { x: 0, y: 0 }
        return {
          id: node.id,
          type: "device" as const,
          position,
          data: {
            node,
            compact,
            slim,
            exitNode: node.deviceId
              ? (exitNodeByDeviceId?.[node.deviceId] ?? "none")
              : "none",
          },
          selected: selectedNodeId === node.id,
        }
      }),
    [nodes, overrides, positions, selectedNodeId, compact, slim, exitNodeByDeviceId]
  )

  const flowEdges = useMemo<Edge[]>(
    () =>
      links.map((link) => {
        const relayed = link.kind === "relayed"
        // The network map uses ping pills: protocol and loss stay in the side
        // panel, where there is room to read them.
        const label = pingLabels
          ? relayed
            ? `${link.viaHostname ?? t("topology.relay")} · ${t("topology.hops", { count: link.cost ?? "?" })}`
            : link.latencyMs !== null
              ? `${link.latencyMs} ms`
              : link.protocol
          : relayed
            ? `${link.viaHostname ?? t("topology.relay")} · ${t("topology.hops", { count: link.cost ?? "?" })}${
                link.protocolIsFirstHop ? ` · ${link.protocol}` : ""
              }`
            : [
                link.protocol,
                link.latencyMs !== null ? `${link.latencyMs} ms` : null,
                link.lossPercent !== null && link.lossPercent > 0
                  ? `${link.lossPercent}% loss`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
        const from = positions.get(link.source)
        const to = positions.get(link.target)
        const short =
          from && to ? Math.hypot(from.x - to.x, from.y - to.y) < 230 : false
        return {
          id: link.id,
          type: "direct" as const,
          source: link.source,
          target: link.target,
          label: pingLabels && short ? "" : label,
          animated: false,
          style: {
            stroke: relayed ? "rgb(245 158 11)" : "rgb(16 185 129)",
            strokeWidth: 1.6,
            strokeDasharray: relayed ? "6 4" : undefined,
          },
          labelStyle: { fontSize: 10, fill: "currentColor" },
          labelBgStyle: { fill: "var(--card)", fillOpacity: 0.85 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          data: { link },
        }
      }),
    [links, pingLabels, positions, t]
  )

  const handleNodesChange: OnNodesChange<Node<DeviceNodeData, "device">> = useCallback(
    (changes: NodeChange<Node<DeviceNodeData, "device">>[]) => {
      const moved = changes.filter(
        (change) => change.type === "position" && change.position
      )
      if (moved.length === 0) return
      setOverrides((current) => {
        const next = { ...current }
        for (const change of moved) {
          if (change.type !== "position" || !change.position) continue
          next[change.id] = change.position
        }
        return next
      })
    },
    []
  )

  return (
    <div
      className={cn(
        "h-[68vh] min-h-96 w-full rounded-lg border border-line bg-surface-2/40",
        className
      )}
    >
      <ReactFlow
        edgeTypes={edgeTypes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.15}
        nodeTypes={nodeTypes}
        nodes={flowNodes}
        onEdgeClick={(_, edge) => onSelectLink?.(edge.id)}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodesChange={handleNodesChange}
        onPaneClick={() => {
          onSelectNode(null)
          onSelectLink?.(null)
        }}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        {minimap ? (
          <MiniMap
            className="!bg-card"
            maskColor="rgb(0 0 0 / 0.08)"
            nodeColor={(node) =>
              (node.data as DeviceNodeData).node.online ? "#10b981" : "#9ca3af"
            }
            pannable
            zoomable
          />
        ) : null}
      </ReactFlow>
    </div>
  )
}
