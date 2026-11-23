import { QueryClient, QueryObserver } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  applyRealtimeEvent,
  createRealtimeApplier,
} from "@/realtime/apply-event"
import type { RealtimeEvent } from "@/realtime/use-event-stream"

function event(
  partial: Partial<RealtimeEvent> & { type: RealtimeEvent["type"] }
): RealtimeEvent {
  return {
    seq: 1,
    at: new Date().toISOString(),
    orgId: "org",
    topics: [],
    data: {},
    ...partial,
  }
}

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    networkId: "n1",
    state: "approved",
    online: "online",
    sync: "in-sync",
    label: "approved/online/in-sync",
    hostname: "node-1",
    dnsName: "node-1",
    virtualIpv4: "10.144.144.2",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    desiredRevision: 1,
    appliedRevision: 1,
    appliedAt: "2026-01-01T00:00:00.000Z",
    lastPushAt: null,
    lastPushError: null,
    ...overrides,
  }
}

function deviceEvent(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: "d1",
    networkId: "n1",
    state: "approved",
    online: "online",
    sync: "in-sync",
    hostname: "node-1",
    virtualIpv4: "10.144.144.2",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    desiredRevision: 1,
    appliedRevision: 1,
    appliedAt: "2026-01-01T00:00:00.000Z",
    lastPushAt: null,
    lastPushError: null,
    reason: "heartbeat",
    changed: ["lastSeenAt"],
    ...overrides,
  }
}

function clientWithData() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(["/api/devices"], { data: [device()] })
  client.setQueryData(["/api/devices", { networkId: "n1" }], {
    data: [device()],
  })
  client.setQueryData(["/api/devices", { state: "pending" }], {
    data: [],
  })
  client.setQueryData(["/api/devices/d1"], { data: device() })
  client.setQueryData(["/api/devices/d1/revisions"], { data: [] })
  client.setQueryData(["/api/devices/d1/routes"], { data: [] })
  client.setQueryData(["/api/networks"], {
    data: [{ id: "n1", deviceCounts: { pending: 0, approved: 1, blocked: 0 } }],
  })
  client.setQueryData(["/api/networks/n1"], {
    data: { id: "n1", access: { onlineAnchors: 1 } },
  })
  client.setQueryData(["/api/networks/n2"], {
    data: { id: "n2", access: { onlineAnchors: 0 } },
  })
  client.setQueryData(["/api/networks/n1/routes"], { data: { routes: [] } })
  client.setQueryData(["/api/networks/n1/policy"], {
    data: { version: 1 },
  })
  client.setQueryData(["/api/networks/n1/wireguard-clients"], { data: [] })
  client.setQueryData(["/api/tags"], { data: [] })
  client.setQueryData(["/api/user-groups"], { data: [] })
  return client
}

function invalidated(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true
}

describe("realtime event -> query cache", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("patches device lists and detail in place for a lastSeen-only event", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({
        type: "device.updated",
        deviceId: "d1",
        networkId: "n1",
        data: deviceEvent({
          lastSeenAt: "2026-01-01T00:05:00.000Z",
          changed: ["lastSeenAt"],
        }),
      })
    )

    const list = client.getQueryData<{ data: Array<Record<string, unknown>> }>([
      "/api/devices",
    ])
    expect(list?.data[0]?.lastSeenAt).toBe("2026-01-01T00:05:00.000Z")
    const detail = client.getQueryData<{ data: Record<string, unknown> }>([
      "/api/devices/d1",
    ])
    expect(detail?.data.lastSeenAt).toBe("2026-01-01T00:05:00.000Z")
    // No node is in the payload, so nothing is refetched for a heartbeat.
    expect(invalidated(client, ["/api/devices"])).toBe(false)
    expect(invalidated(client, ["/api/devices/d1"])).toBe(false)
    expect(invalidated(client, ["/api/networks/n1"])).toBe(false)
  })

  it("patches online/sync/revision fields and only invalidates that network's detail", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({
        type: "device.updated",
        deviceId: "d1",
        networkId: "n1",
        data: deviceEvent({
          online: "offline",
          sync: "stale",
          desiredRevision: 3,
          appliedRevision: 1,
          changed: ["online", "sync", "desiredRevision"],
        }),
      })
    )

    const detail = client.getQueryData<{ data: Record<string, unknown> }>([
      "/api/devices/d1",
    ])
    expect(detail?.data.online).toBe("offline")
    expect(detail?.data.sync).toBe("stale")
    expect(detail?.data.desiredRevision).toBe(3)
    expect(detail?.data.label).toBe("approved/offline/stale")

    // Online anchors live on the network detail; the networks list counts
    // states, not liveness, and the device list was patched in place.
    expect(invalidated(client, ["/api/networks/n1"])).toBe(true)
    expect(invalidated(client, ["/api/networks/n2"])).toBe(false)
    expect(invalidated(client, ["/api/networks"])).toBe(false)
    expect(invalidated(client, ["/api/devices"])).toBe(false)
  })

  it("refetches counts and the one network's tables only when the state changes", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({
        type: "device.updated",
        deviceId: "d1",
        networkId: "n1",
        data: deviceEvent({
          state: "blocked",
          online: "offline",
          changed: ["state", "online"],
          reason: "blocked",
        }),
      })
    )

    expect(invalidated(client, ["/api/networks"])).toBe(true)
    expect(invalidated(client, ["/api/networks/n1"])).toBe(true)
    expect(invalidated(client, ["/api/devices"])).toBe(true)
    expect(invalidated(client, ["/api/devices", { networkId: "n1" }])).toBe(
      true
    )
    expect(invalidated(client, ["/api/devices/d1"])).toBe(true)
    // Another network and unrelated collections stay untouched.
    expect(invalidated(client, ["/api/networks/n2"])).toBe(false)
    expect(invalidated(client, ["/api/tags"])).toBe(false)
    expect(invalidated(client, ["/api/user-groups"])).toBe(false)
  })

  it("keeps policy events inside the network", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({ type: "policy.updated", networkId: "n1", data: { version: 2 } })
    )
    expect(invalidated(client, ["/api/networks/n1/policy"])).toBe(true)
    expect(invalidated(client, ["/api/networks/n1"])).toBe(true)
    expect(invalidated(client, ["/api/networks/n2"])).toBe(false)
    expect(invalidated(client, ["/api/networks/n2/policy"])).toBe(false)
    expect(invalidated(client, ["/api/tags"])).toBe(false)
  })

  it("invalidates a route's network, device and detail but not whole prefixes", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({
        type: "route.updated",
        networkId: "n1",
        deviceId: "d1",
        data: { networkId: "n1", deviceId: "d1", routeId: "r1" },
      })
    )
    expect(invalidated(client, ["/api/networks/n1/routes"])).toBe(true)
    expect(invalidated(client, ["/api/devices/d1/routes"])).toBe(true)
    expect(invalidated(client, ["/api/devices/d1"])).toBe(true)
    expect(invalidated(client, ["/api/networks", "n2"])).toBe(false)
    expect(invalidated(client, ["/api/networks/n2/routes"])).toBe(false)
    expect(invalidated(client, ["/api/tags"])).toBe(false)
  })

  it("invalidates tag and user-group collections with their events", () => {
    const client = clientWithData()
    applyRealtimeEvent(
      client,
      event({ type: "tag.updated", data: { tagId: "t1" } })
    )
    expect(invalidated(client, ["/api/tags"])).toBe(true)
    expect(invalidated(client, ["/api/networks/n1/policy"])).toBe(true)

    const second = clientWithData()
    applyRealtimeEvent(
      second,
      event({ type: "user_group.updated", data: { groupId: "g1" } })
    )
    expect(invalidated(second, ["/api/user-groups"])).toBe(true)
    expect(invalidated(second, ["/api/networks/n1/policy"])).toBe(true)
  })

  it("patches topology in place instead of refetching", () => {
    const client = new QueryClient()
    client.setQueryData(["/api/networks/n1/topology"], {
      data: {
        networkId: "n1",
        collectedAt: "2026-01-01T00:00:00.000Z",
        nodes: [{ id: "old" }],
        links: [],
      },
      status: 200,
    })
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
    expect(
      client.getQueryState(["/api/networks/n1/topology"])?.isInvalidated
    ).toBe(false)
  })

  it("patches WireGuard client status from the event payload", () => {
    const client = new QueryClient()
    client.setQueryData(["/api/networks/n1/wireguard-clients"], {
      data: [
        {
          id: "w1",
          networkId: "n1",
          state: "offline",
          endpoint: null,
          tunnelIp: null,
          peerId: null,
          error: null,
          statusAt: null,
        },
      ],
    })
    applyRealtimeEvent(
      client,
      event({
        type: "wireguard.updated",
        networkId: "n1",
        data: {
          networkId: "n1",
          reason: "status",
          statuses: [
            {
              clientId: "w1",
              state: "online",
              endpoint: "203.0.113.7:51820",
              tunnelIp: "10.144.144.9",
              peerId: 7,
              error: null,
              statusAt: "2026-01-01T00:00:05.000Z",
            },
          ],
        },
      })
    )
    const cached = client.getQueryData<{
      data: Array<Record<string, unknown>>
    }>(["/api/networks/n1/wireguard-clients"])
    expect(cached?.data[0]?.state).toBe("online")
    expect(cached?.data[0]?.peerId).toBe(7)
    expect(
      client.getQueryState(["/api/networks/n1/wireguard-clients"])
        ?.isInvalidated
    ).toBe(false)
  })
})

describe("coalesced invalidations", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("turns a burst of events into one invalidate call", async () => {
    vi.useFakeTimers()
    const client = clientWithData()
    const spy = vi.spyOn(client, "invalidateQueries")
    const applier = createRealtimeApplier(client, {
      coalesceMs: 350,
      isHidden: () => false,
    })

    for (let index = 0; index < 12; index += 1) {
      applier.apply(
        event({
          type: "device.updated",
          deviceId: "d1",
          networkId: "n1",
          data: deviceEvent({
            online: index % 2 === 0 ? "offline" : "online",
            changed: ["online"],
          }),
        })
      )
    }

    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(349)
    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(spy).toHaveBeenCalledTimes(1)

    const options = spy.mock.calls[0]?.[0] as {
      predicate: (query: { queryKey: readonly unknown[] }) => boolean
      refetchType: string
    }
    expect(options.refetchType).toBe("active")
    expect(options.predicate({ queryKey: ["/api/networks/n1"] })).toBe(true)
    expect(
      options.predicate({ queryKey: ["/api/devices", { networkId: "n1" }] })
    ).toBe(false)
    expect(options.predicate({ queryKey: ["/api/tags"] })).toBe(false)
    expect(options.predicate({ queryKey: ["/api/networks/n2"] })).toBe(false)
    applier.dispose()
  })

  it("does nothing for a lastSeen-only burst", async () => {
    vi.useFakeTimers()
    const client = clientWithData()
    const spy = vi.spyOn(client, "invalidateQueries")
    const applier = createRealtimeApplier(client, {
      coalesceMs: 350,
      isHidden: () => false,
    })
    for (let index = 0; index < 6; index += 1) {
      applier.apply(
        event({
          type: "device.updated",
          deviceId: "d1",
          networkId: "n1",
          data: deviceEvent({
            lastSeenAt: `2026-01-01T00:00:0${index}.000Z`,
            changed: ["lastSeenAt"],
          }),
        })
      )
    }
    await vi.advanceTimersByTimeAsync(500)
    expect(spy).not.toHaveBeenCalled()
    expect(applier.pendingSize).toBe(0)
    applier.dispose()
  })

  it("defers invalidations while the tab is hidden and flushes on return", async () => {
    vi.useFakeTimers()
    const client = clientWithData()
    const spy = vi.spyOn(client, "invalidateQueries")
    let hidden = true
    const applier = createRealtimeApplier(client, {
      coalesceMs: 350,
      isHidden: () => hidden,
    })
    applier.apply(
      event({
        type: "device.updated",
        deviceId: "d1",
        networkId: "n1",
        data: deviceEvent({ online: "offline", changed: ["online"] }),
      })
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(spy).not.toHaveBeenCalled()

    hidden = false
    document.dispatchEvent(new Event("visibilitychange"))
    expect(spy).toHaveBeenCalledTimes(1)
    applier.dispose()
  })

  it("refetches only observed queries when the flush happens", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const queryFn = vi.fn(async () => ({ data: [] }))
    await client.fetchQuery({
      queryKey: ["/api/devices", { networkId: "n1" }],
      queryFn,
    })
    const unsubscribed = client.getQueryCache().build(client, {
      queryKey: ["/api/networks/n2"],
      queryFn: vi.fn(async () => ({ data: { id: "n2" } })),
    })
    expect(unsubscribed).toBeDefined()

    const observer = new QueryObserver(client, {
      queryKey: ["/api/devices", { networkId: "n1" }],
      queryFn,
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    const applier = createRealtimeApplier(client, {
      coalesceMs: 20,
      isHidden: () => false,
    })
    applier.apply(
      event({
        type: "device.updated",
        deviceId: "d1",
        networkId: "n1",
        data: deviceEvent({
          state: "blocked",
          online: "offline",
          changed: ["state", "online"],
          reason: "blocked",
        }),
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(queryFn).toHaveBeenCalledTimes(2)
    unsubscribe()
    applier.dispose()
  })
})
