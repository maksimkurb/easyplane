import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { RadioTowerIcon } from "lucide-react"

import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
} from "@/api/generated/model"
import { DeviceIcon } from "@/components/device/device-icon"
import { layoutTopology } from "@/lib/topology-layout"
import { cn } from "@/lib/utils"

type DeviceOs = { type?: string | null; distribution?: string | null }

const WIDTH = 390
const HEIGHT = 420
const MAX_RADIUS = 150

type Position = { x: number; y: number }

/**
 * Phone map. React Flow's fit-to-view makes a radial layout unreadable on a
 * 390px screen (everything shrinks to half size), so phones get the design's
 * compact circular nodes at a fixed, legible scale instead.
 */
export function CompactTopologyMap({
  nodes,
  links,
  selectedNodeId,
  onSelectNode,
  deviceOsById,
}: {
  nodes: TopologyNode[]
  links: TopologyLink[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  deviceOsById?: Record<string, DeviceOs>
}) {
  const { t } = useTranslation()

  const positions = useMemo(() => {
    const raw = layoutTopology(
      nodes.map((node) => ({
        id: node.id,
        label: node.hostname,
        relayCapable: node.relayCapable,
        online: node.online,
      })),
      links,
      {
        baseRadius: 132,
        ringGap: 140,
        minSpacing: 92,
        nodeWidth: 64,
      }
    )
    // Keep dense graphs on the canvas: scale every ring down together, never
    // up (a small graph stays readable at its natural radius).
    let largest = 0
    for (const position of raw.values()) {
      largest = Math.max(largest, Math.hypot(position.x, position.y))
    }
    const scale = largest > MAX_RADIUS ? MAX_RADIUS / largest : 1
    const scaled = new Map<string, Position>()
    for (const [id, position] of raw) {
      scaled.set(id, { x: position.x * scale, y: position.y * scale })
    }
    return scaled
  }, [nodes, links])

  const point = (id: string): Position | null => {
    const position = positions.get(id)
    if (!position) return null
    return { x: WIDTH / 2 + position.x, y: HEIGHT / 2 + position.y }
  }

  return (
    <div
      aria-label={t("topology.title")}
      className="relative mx-auto aspect-[390/420] w-full max-w-[420px] overflow-hidden"
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {links.map((link) => {
          const from = point(link.source)
          const to = point(link.target)
          if (!from || !to) return null
          const relayed = link.kind === "relayed"
          return (
            <line
              key={link.id}
              stroke={relayed ? "var(--warn)" : "var(--ok-dot)"}
              strokeDasharray={relayed ? "6 5" : undefined}
              strokeWidth={2}
              x1={from.x}
              x2={to.x}
              y1={from.y}
              y2={to.y}
            />
          )
        })}
      </svg>

      {links.map((link) => {
        const from = point(link.source)
        const to = point(link.target)
        if (!from || !to || link.latencyMs === null) return null
        const relayed = link.kind === "relayed"
        return (
          <span
            className={cn(
              "absolute z-[1] inline-flex h-[20px] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-card px-1.5 font-mono text-[10px] font-medium whitespace-nowrap shadow-sm ring-1",
              relayed ? "text-warn ring-warn-line" : "text-fg-2 ring-line-2"
            )}
            key={`ping-${link.id}`}
            style={{
              left: `${((from.x + to.x) / 2 / WIDTH) * 100}%`,
              top: `${((from.y + to.y) / 2 / HEIGHT) * 100}%`,
            }}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                relayed ? "bg-warn" : "bg-ok-dot"
              )}
            />
            {link.latencyMs} ms
          </span>
        )
      })}

      {nodes.map((node) => {
        const position = point(node.id)
        if (!position) return null
        const selected = node.id === selectedNodeId
        const os = node.deviceId ? deviceOsById?.[node.deviceId] : undefined
        return (
          <button
            aria-label={t("topology.nodeState", {
              name: node.hostname || node.id,
              state: node.online
                ? t("devices.status.online")
                : t("devices.status.offline"),
            })}
            aria-pressed={selected}
            className={cn(
              "absolute z-[2] flex w-[96px] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-1 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              !node.online && "opacity-60"
            )}
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            style={{
              left: `${(position.x / WIDTH) * 100}%`,
              top: `${(position.y / HEIGHT) * 100}%`,
            }}
            type="button"
          >
            <span
              className={cn(
                "relative grid size-11 place-items-center rounded-full bg-card text-fg-2 shadow-sm ring-1 ring-line-2",
                !node.online &&
                  "outline outline-1 outline-line-2 outline-dashed",
                selected && "text-brand-text ring-2 ring-brand"
              )}
            >
              {os ? (
                <DeviceIcon className="size-[18px]" os={os} />
              ) : (
                <RadioTowerIcon aria-hidden="true" className="size-[18px]" />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-0 bottom-0 size-[11px] rounded-full ring-2 ring-card",
                  node.online ? "bg-ok-dot" : "bg-fg-3"
                )}
              />
              {node.relayCapable ? (
                <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-relay text-white ring-2 ring-card">
                  <RadioTowerIcon aria-hidden="true" className="size-3" />
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "max-w-[96px] truncate rounded-md bg-card px-1.5 py-px text-[11.5px] leading-4 font-semibold ring-1 ring-line",
                selected && "text-brand-text"
              )}
              title={node.hostname || node.id}
            >
              {node.hostname || node.id}
            </span>
          </button>
        )
      })}
    </div>
  )
}
