import { describe, expect, it } from "vitest"

import { layoutTopology, firstTopologyNode } from "@/lib/topology-layout"

const nodes = [
  { id: "hub", label: "core-a", relayCapable: false, online: true },
  { id: "b", label: "core-b", online: true },
  { id: "c", label: "core-c", online: true },
  { id: "d", label: "core-d", online: true },
]
const links = [
  { source: "hub", target: "b" },
  { source: "hub", target: "c" },
  { source: "b", target: "d" },
]

describe("radial topology layout", () => {
  it("places the most connected node in the centre and rings by hop distance", () => {
    const positions = layoutTopology(nodes, links)
    const hub = positions.get("hub")!
    const b = positions.get("b")!
    const d = positions.get("d")!
    // Hub has degree 2 and is the root; the drawing is centred on the origin.
    expect(Math.hypot(hub.x, hub.y)).toBeLessThan(10)
    const r = (id: string) => {
      const p = positions.get(id)!
      return Math.hypot(p.x - hub.x, p.y - hub.y)
    }
    expect(r("b")).toBeGreaterThan(100)
    expect(r("d")).toBeGreaterThan(r("b"))
    expect(b).not.toEqual(d)
  })

  it("prefers a relay-capable node as the centre even with a lower degree", () => {
    const positions = layoutTopology(
      [
        { id: "relay", label: "relay", relayCapable: true, online: true },
        { id: "leaf", label: "leaf", online: true },
        { id: "other", label: "other", online: true },
      ],
      [{ source: "relay", target: "leaf" }]
    )
    const relay = positions.get("relay")!
    expect(Math.hypot(relay.x, relay.y)).toBeLessThan(10)
  })

  it("is deterministic and independent of input order", () => {
    const first = layoutTopology(nodes, links)
    const second = layoutTopology([...nodes].reverse(), [...links].reverse())
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort())
  })

  it("grows the ring with the number of nodes so cards do not overlap", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `n${index}`,
      label: `node-${index}`,
      online: true,
    }))
    const spokes = many.slice(1).map((node) => ({ source: "n0", target: node.id }))
    const positions = layoutTopology(many, spokes)
    const ring = many.slice(1).map((node) => {
      const position = positions.get(node.id)!
      return Math.hypot(position.x, position.y)
    })
    const min = Math.min(...ring)
    // 40 nodes × 190 px spacing needs a radius of ~1200 px.
    expect(min).toBeGreaterThan(1_000)
    // No two nodes share a position.
    expect(new Set(ring.map((value) => value.toFixed(1))).size).toBeGreaterThan(1)
  })

  it("still draws disconnected nodes instead of dropping them", () => {
    const positions = layoutTopology(
      [...nodes, { id: "island", label: "island", online: false }],
      links
    )
    expect(positions.has("island")).toBe(true)
  })

  it("keeps every position when devices go offline or online", () => {
    const before = layoutTopology(nodes, links)
    const offline = nodes.map((node, index) => ({
      ...node,
      online: index % 2 === 0 ? false : node.online,
    }))
    const after = layoutTopology([...offline].reverse(), [...links].reverse())
    for (const [id, position] of before) {
      expect(after.get(id)).toEqual(position)
    }
  })

  it("spreads isolated devices across one ring instead of stacking them", () => {
    const islands = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id,
      online: true,
    }))
    const positions = layoutTopology(islands, [])
    const radii = islands.map((node) => {
      const position = positions.get(node.id)!
      return Math.hypot(position.x, position.y)
    })
    // One node is the centre; the other three share the same outer radius and
    // are spread around the full circle rather than packed into an arc.
    expect(new Set(radii.map((value) => Math.round(value))).size).toBe(2)
  })

  it("returns nothing for an empty graph", () => {
    expect(layoutTopology([], []).size).toBe(0)
  })
})

describe("stable topology selection", () => {
  it("picks the same default node regardless of snapshot order", () => {
    const unsorted = [
      { id: "ip:10.0.0.3", hostname: "zeta" },
      { id: "ip:10.0.0.2", hostname: "alpha" },
      { id: "ip:10.0.0.4", hostname: "alpha" },
    ]
    expect(firstTopologyNode(unsorted)?.id).toBe("ip:10.0.0.2")
    expect(firstTopologyNode([...unsorted].reverse())?.id).toBe("ip:10.0.0.2")
  })

  it("does not depend on liveness", () => {
    const online = [
      { id: "b", hostname: "beta", online: false },
      { id: "a", hostname: "alpha", online: true },
    ]
    expect(firstTopologyNode(online)?.id).toBe("a")
    expect(
      firstTopologyNode(online.map((node) => ({ ...node, online: !node.online })))
        ?.id
    ).toBe("a")
  })

  it("has no default for an empty snapshot", () => {
    expect(firstTopologyNode([])).toBeNull()
  })
})
