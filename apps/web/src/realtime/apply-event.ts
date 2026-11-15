import type { QueryClient } from "@tanstack/react-query"

import type { RealtimeEvent } from "./use-event-stream"

/** True when any query key starts with the given URL prefix. */
function matchesPrefix(queryKey: readonly unknown[], prefix: string): boolean {
  const first = queryKey[0]
  return typeof first === "string" && first.startsWith(prefix)
}

/**
 * Applies one realtime event to the TanStack Query cache.
 *
 * The server event is a hint: full objects stay in the query cache and are
 * refetched through the normal authenticated API. The one exception is the
 * topology snapshot, which is pushed whole so the map can update without a
 * round trip (and without a flash of the previous graph).
 */
export function applyRealtimeEvent(
  queryClient: QueryClient,
  event: RealtimeEvent
): void {
  switch (event.type) {
    case "device.updated":
    case "device.removed": {
      // Lists, details, revisions, routes and per-network device tables all
      // live under these prefixes.
      invalidateByPrefix(queryClient, "/api/devices")
      invalidateByPrefix(queryClient, "/api/networks")
      return
    }
    case "network.updated":
    case "network.deleted": {
      invalidateByPrefix(queryClient, "/api/networks")
      invalidateByPrefix(queryClient, "/api/devices")
      invalidateByPrefix(queryClient, "/api/invites")
      return
    }
    case "policy.updated": {
      invalidateByPrefix(queryClient, "/api/networks")
      invalidateByPrefix(queryClient, "/api/devices")
      return
    }
    case "route.updated": {
      invalidateByPrefix(queryClient, "/api/networks")
      invalidateByPrefix(queryClient, "/api/devices")
      return
    }
    case "topology.updated": {
      const data = event.data as {
        networkId?: string
        collectedAt?: string
        nodes?: unknown[]
        links?: unknown[]
        stats?: unknown
      }
      if (!data.networkId) return
      const prefix = `/api/networks/${data.networkId}/topology`
      queryClient.setQueriesData<{ data?: Record<string, unknown> } | undefined>(
        { predicate: (query) => matchesPrefix(query.queryKey, prefix) },
        (previous) => {
          if (!previous?.data) return previous
          return {
            ...previous,
            data: {
              ...previous.data,
              collectedAt: data.collectedAt ?? previous.data.collectedAt,
              nodes: data.nodes ?? previous.data.nodes,
              links: data.links ?? previous.data.links,
              stats: data.stats ?? previous.data.stats,
            },
          }
        }
      )
      return
    }
    case "hello":
    case "resync":
      return
  }
}

function invalidateByPrefix(queryClient: QueryClient, prefix: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) => matchesPrefix(query.queryKey, prefix),
  })
}
