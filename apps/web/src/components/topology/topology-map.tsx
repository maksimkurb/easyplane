import { useCallback, useMemo, useState } from "react"
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnNodesChange,
  type NodeChange,
} from "@xyflow/react"
import { useTranslation } from "react-i18next"
import { RadioTowerIcon } from "lucide-react"

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
  exitNode: ExitNodeState
}

const nodeTypes: NodeTypes = { device: DeviceNode }

/**
 * One device card. Relay-capable nodes get a violet ring and a tower badge;
 * offline nodes are muted. The card carries a native tooltip with the fields
 * the map cannot fit, and clicking opens the detail drawer.
 */
export function TopologyNodeCard({
  node,
  exitNode = "none",
  selected,
}: {
  node: TopologyNode
  exitNode?: ExitNodeState
  selected: boolean
}) {
  const { t } = useTranslation()
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
        "w-[180px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-shadow",
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
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
        {node.virtualIpv4 ?? t("common.none")}
        {node.peerId ? ` · #${node.peerId}` : ""}
      </div>
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
    </div>
  )
}

function DeviceNode({ data, selected }: NodeProps<Node<DeviceNodeData, "device">>) {
  return (
    <TopologyNodeCard
      exitNode={data.exitNode}
      node={data.node}
      selected={Boolean(selected)}
    />
  )
}

export interface TopologyMapProps {
  nodes: TopologyNode[]
  links: TopologyLink[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onSelectLink?: (linkId: string | null) => void
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
        links
      ),
    [nodes, links]
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
            exitNode: node.deviceId
              ? (exitNodeByDeviceId?.[node.deviceId] ?? "none")
              : "none",
          },
          selected: selectedNodeId === node.id,
        }
      }),
    [nodes, overrides, positions, selectedNodeId, exitNodeByDeviceId]
  )

  const flowEdges = useMemo<Edge[]>(
    () =>
      links.map((link) => {
        const relayed = link.kind === "relayed"
        const label = relayed
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
        return {
          id: link.id,
          source: link.source,
          target: link.target,
          label,
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
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
    [links, t]
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
    <div className="h-[68vh] min-h-96 w-full rounded-lg border bg-muted/20">
      <ReactFlow
        edges={flowEdges}
        fitView
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
        <MiniMap
          className="!bg-card"
          maskColor="rgb(0 0 0 / 0.08)"
          nodeColor={(node) =>
            (node.data as DeviceNodeData).node.online ? "#10b981" : "#9ca3af"
          }
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}
