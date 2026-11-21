import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { RadioTowerIcon } from "lucide-react"

import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
} from "@/api/generated/model"
import { DeviceIcon } from "@/components/device/device-icon"
import {
  compareTopologyNodes,
  topologyLevels,
} from "@/lib/topology-layout"
import { cn } from "@/lib/utils"

type DeviceOs = { type?: string | null; distribution?: string | null }

/**
 * Design canvas. Square, so percentages map to the same distance on both axes
 * at any width: the phone map is a hub in the centre with every device on one
 * ring. Concentric hop rings cannot fit a 390px screen at a legible card size
 * (two rings already need ~600px), and scaling them down made cards overlap.
 */
const WIDTH = 390
const HEIGHT = 390
/** Icon-only fallback for nodes without an OS glyph. */
const NODE_WIDTH = 96
const NODE_HEIGHT = 72
/** Ring radius, in canvas units: half the canvas minus half a card. */
const RADIUS = WIDTH / 2 - NODE_WIDTH / 2 - 11
/** Ping pills are hidden when they would sit on top of a device card. */
const PILL_HALF_WIDTH = 30
const PILL_HALF_HEIGHT = 12

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
    const result = new Map<string, Position>()
    const shape = topologyLevels(
      nodes.map((node) => ({
        id: node.id,
        label: node.hostname,
        relayCapable: node.relayCapable,
        online: node.online,
      })),
      links
    )
    if (!shape) return result

    result.set(shape.rootId, { x: WIDTH / 2, y: HEIGHT / 2 })
    // Order by hop distance, then by the stable name+id key, so the first ring
    // position belongs to the closest peer and a snapshot reorder never moves
    // a device to another part of the circle.
    const satellites = nodes
      .filter((node) => node.id !== shape.rootId)
      .sort((left, right) => {
        const hop =
          (shape.level.get(left.id) ?? 0) - (shape.level.get(right.id) ?? 0)
        return hop !== 0 ? hop : compareTopologyNodes(left, right)
      })
    const count = satellites.length
    satellites.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count
      result.set(node.id, {
        x: WIDTH / 2 + Math.cos(angle) * RADIUS,
        y: HEIGHT / 2 + Math.sin(angle) * RADIUS,
      })
    })
    return result
  }, [nodes, links])

  const point = (id: string): Position | null => positions.get(id) ?? null

  const cards = useMemo(() => {
    const result: Array<{ node: TopologyNode; position: Position }> = []
    for (const node of nodes) {
      const position = positions.get(node.id)
      if (position) result.push({ node, position })
    }
    return result
  }, [nodes, positions])

  const coversCard = (x: number, y: number) =>
    cards.some(
      (card) =>
        Math.abs(x - card.position.x) < NODE_WIDTH / 2 + PILL_HALF_WIDTH &&
        Math.abs(y - card.position.y) < NODE_HEIGHT / 2 + PILL_HALF_HEIGHT
    )

  return (
    <div
      aria-label={t("topology.title")}
      className="relative mx-auto aspect-square w-full max-w-[440px] overflow-hidden"
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
        const x = (from.x + to.x) / 2
        const y = (from.y + to.y) / 2
        // A pill that lands on a card hides a hostname, which is worse than
        // losing the latency on a 390px screen.
        if (coversCard(x, y)) return null
        const relayed = link.kind === "relayed"
        return (
          <span
            className="absolute z-[1] inline-flex h-[22px] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-card px-2 font-mono text-xs leading-none font-medium whitespace-nowrap text-fg-2 shadow-sm ring-1 ring-line-2 tabular-nums"
            key={`ping-${link.id}`}
            style={{
              left: `${(x / WIDTH) * 100}%`,
              top: `${(y / HEIGHT) * 100}%`,
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

      {cards.map(({ node, position }) => {
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
                "relative grid size-12 place-items-center rounded-full bg-card text-fg-2 shadow-sm ring-1 ring-line-2",
                !node.online &&
                  "outline outline-1 outline-line-2 outline-dashed",
                selected && "text-brand-text ring-2 ring-brand"
              )}
            >
              {os ? (
                <DeviceIcon className="size-5" os={os} />
              ) : (
                <RadioTowerIcon aria-hidden="true" className="size-5" />
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
                "max-w-[96px] truncate rounded-md bg-card px-1.5 py-px text-xs leading-4 font-semibold ring-1 ring-line",
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
