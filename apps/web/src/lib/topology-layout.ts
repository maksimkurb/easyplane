export interface LayoutNodeInput {
  id: string
  label?: string
  relayCapable?: boolean
  online?: boolean
}

export interface LayoutLinkInput {
  source: string
  target: string
}

export interface LayoutPosition {
  x: number
  y: number
}

export interface LayoutOptions {
  baseRadius?: number
  ringGap?: number
  minSpacing?: number
  nodeWidth?: number
  nodeHeight?: number
}

/**
 * Deterministic radial layout for the connectivity map.
 *
 * Why not a force layout: force-directed drawings of a few hundred nodes are
 * slow, jump around between snapshots and give no stable place to a device.
 * This layout is O(V+E), stable for a given graph, and meaningful: the most
 * connected relay-capable node sits in the centre and every ring is one hop
 * further away from it. Rings grow with the number of nodes so device cards do
 * not overlap, which keeps tens to hundreds of nodes readable without an extra
 * layout dependency. Users can still drag nodes; the page keeps those
 * positions until the node disappears.
 */
export function layoutTopology(
  nodes: readonly LayoutNodeInput[],
  links: readonly LayoutLinkInput[],
  options: LayoutOptions = {}
): Map<string, LayoutPosition> {
  const {
    baseRadius = 220,
    ringGap = 260,
    minSpacing = 190,
    nodeWidth = 180,
  } = options

  const positions = new Map<string, LayoutPosition>()
  if (nodes.length === 0) return positions

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) adjacency.set(node.id, [])
  for (const link of links) {
    if (!byId.has(link.source) || !byId.has(link.target)) continue
    adjacency.get(link.source)!.push(link.target)
    adjacency.get(link.target)!.push(link.source)
  }

  const degree = (id: string) => adjacency.get(id)?.length ?? 0
  const root =
    [...nodes]
      .sort((left, right) => {
        const relay = Number(Boolean(right.relayCapable)) - Number(Boolean(left.relayCapable))
        if (relay !== 0) return relay
        const online = Number(Boolean(right.online)) - Number(Boolean(left.online))
        if (online !== 0) return online
        const degreeDelta = degree(right.id) - degree(left.id)
        if (degreeDelta !== 0) return degreeDelta
        return labelOf(left).localeCompare(labelOf(right)) || left.id.localeCompare(right.id)
      })[0]!

  // BFS hop distance from the root.
  const level = new Map<string, number>([[root.id, 0]])
  const queue = [root.id]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of adjacency.get(current) ?? []) {
      if (level.has(next)) continue
      level.set(next, (level.get(current) ?? 0) + 1)
      queue.push(next)
    }
  }
  const unreachable = [...nodes]
    .filter((node) => !level.has(node.id))
    .sort((left, right) => labelOf(left).localeCompare(labelOf(right)) || left.id.localeCompare(right.id))
  let lastLevel = Math.max(0, ...level.values())
  for (const node of unreachable) {
    lastLevel += 1
    level.set(node.id, lastLevel)
  }

  const rings = new Map<number, LayoutNodeInput[]>()
  for (const node of nodes) {
    const ring = level.get(node.id) ?? 0
    const bucket = rings.get(ring) ?? []
    bucket.push(node)
    rings.set(ring, bucket)
  }

  for (const [ring, bucket] of [...rings.entries()].sort(([left], [right]) => left - right)) {
    const ordered = [...bucket].sort(
      (left, right) =>
        Number(Boolean(right.online)) - Number(Boolean(left.online)) ||
        labelOf(left).localeCompare(labelOf(right)) ||
        left.id.localeCompare(right.id)
    )
    if (ring === 0) {
      // A single centre node (several nodes at hop 0 can only happen when the
      // graph is empty or all nodes are isolated).
      ordered.forEach((node, index) => {
        if (ordered.length === 1) {
          positions.set(node.id, { x: 0, y: 0 })
        } else {
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / ordered.length
          positions.set(node.id, { x: Math.cos(angle) * baseRadius * 0.5, y: Math.sin(angle) * baseRadius * 0.5 })
        }
      })
      continue
    }
    const count = ordered.length
    const needed = (count * Math.max(minSpacing, nodeWidth + 40)) / (2 * Math.PI)
    const radius = Math.max(baseRadius + (ring - 1) * ringGap, needed)
    const start = -Math.PI / 2 + ring * 0.35
    ordered.forEach((node, index) => {
      const angle = start + (index * 2 * Math.PI) / count
      positions.set(node.id, {
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius),
      })
    })
  }

  // The root stays at the origin; React Flow's fitView centres the viewport,
  // so no extra transform is needed (and hop radii stay meaningful).
  return positions
}

function labelOf(node: LayoutNodeInput): string {
  return node.label ?? node.id
}
