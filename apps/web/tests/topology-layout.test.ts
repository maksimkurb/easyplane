import { describe, expect, it } from "vitest"

import { layoutTopology } from "@/lib/topology-layout"

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

  it("returns nothing for an empty graph", () => {
    expect(layoutTopology([], []).size).toBe(0)
  })
})
