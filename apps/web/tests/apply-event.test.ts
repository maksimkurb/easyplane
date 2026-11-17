import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import { applyRealtimeEvent } from "@/realtime/apply-event"
import type { RealtimeEvent } from "@/realtime/use-event-stream"

function event(partial: Partial<RealtimeEvent> & { type: RealtimeEvent["type"] }): RealtimeEvent {
  return {
    seq: 1,
    at: new Date().toISOString(),
    orgId: "org",
    topics: [],
    data: {},
    ...partial,
  }
}

function clientWithData() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(["/api/devices"], { data: [{ id: "d1" }] })
  client.setQueryData(["/api/devices/d1/revisions"], { data: [] })
  client.setQueryData(["/api/networks"], { data: [] })
  client.setQueryData(["/api/networks/n1/policy"], { data: { version: 1 } })
  client.setQueryData(["/api/tags"], { data: [] })
  client.setQueryData(["/api/user-groups"], { data: [] })
  return client
}

describe("realtime event -> query cache", () => {
  it("invalidates device lists, details and nested device queries", async () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({
        type: "device.updated",
        deviceId: "d1",
        networkId: "n1",
        data: { deviceId: "d1", online: "offline" },
      })
    )
    expect(client.getQueryState(["/api/devices"])?.isInvalidated).toBe(true)
    expect(client.getQueryState(["/api/devices/d1/revisions"])?.isInvalidated).toBe(true)
    // Network counts also change with a device status.
    expect(client.getQueryState(["/api/networks"])?.isInvalidated).toBe(true)
    // Unrelated trees are untouched.
    expect(client.getQueryState(["/api/tags"])?.isInvalidated).toBe(false)
  })

  it("invalidates policy and routes with a policy event", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({ type: "policy.updated", networkId: "n1", data: { version: 2 } })
    )
    expect(client.getQueryState(["/api/networks/n1/policy"])?.isInvalidated).toBe(true)
  })

  it("invalidates tag and user-group collections with their events", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({ type: "tag.updated", data: { tagId: "t1" } })
    )
    expect(client.getQueryState(["/api/tags"])?.isInvalidated).toBe(true)
    expect(client.getQueryState(["/api/networks/n1/policy"])?.isInvalidated).toBe(true)

    const second = clientWithData()
    applyRealtimeEvent(
      second,
      event({ type: "user_group.updated", data: { groupId: "g1" } })
    )
    expect(second.getQueryState(["/api/user-groups"])?.isInvalidated).toBe(true)
    expect(second.getQueryState(["/api/networks/n1/policy"])?.isInvalidated).toBe(true)
  })

  it("patches a topology snapshot in place instead of refetching", () => {
    const client = new QueryClient()
    client.setQueryData(
      ["/api/networks/n1/topology"],
      {
        data: {
          networkId: "n1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          nodes: [{ id: "old" }],
          links: [],
        },
        status: 200,
      }
    )
    const nodes = [{ id: "new" }]
    applyRealtimeEvent(
      client,
      event({
        type: "topology.updated",
        networkId: "n1",
        data: {
          networkId: "n1",
          collectedAt: "2026-01-01T00:00:05.000Z",
          nodes,
          links: [{ id: "l1" }],
        },
      })
    )
    const data = client.getQueryData<{
      data: { collectedAt: string; nodes: unknown[]; links: unknown[] }
    }>(["/api/networks/n1/topology"])
    expect(data?.data.nodes).toEqual(nodes)
    expect(data?.data.links).toEqual([{ id: "l1" }])
    expect(data?.data.collectedAt).toBe("2026-01-01T00:00:05.000Z")
    // The query was updated, not invalidated.
    expect(client.getQueryState(["/api/networks/n1/topology"])?.isInvalidated).toBe(false)
  })

  it("ignores topology events for a different network", () => {
    const client = new QueryClient()
    client.setQueryData(["/api/networks/n1/topology"], {
      data: { nodes: [{ id: "old" }], links: [] },
    })
    applyRealtimeEvent(
      client,
      event({
        type: "topology.updated",
        networkId: "n2",
        data: { networkId: "n2", nodes: [{ id: "n2" }], links: [] },
      })
    )
    const data = client.getQueryData<{ data: { nodes: Array<{ id: string }> } }>([
      "/api/networks/n1/topology",
    ])
    expect(data?.data.nodes).toEqual([{ id: "old" }])
  })

  it("does nothing for hello/resync (the provider handles resync)", () => {
    const client = clientWithData()
    applyRealtimeEvent(client, event({ type: "hello" }))
    applyRealtimeEvent(client, event({ type: "resync", data: { reason: "x" } }))
    expect(client.getQueryState(["/api/devices"])?.isInvalidated).toBe(false)
  })
})
