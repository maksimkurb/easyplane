import type { Query, QueryClient } from "@tanstack/react-query"

import type { RealtimeEvent } from "./use-event-stream"

/**
 * Applies realtime events to the TanStack Query cache.
 *
 * The server event is a hint with enough data for the common case. Events
 * patch the cache in place, and only the queries that really need fresh data
 * are invalidated — narrow keys, never a whole `/api/devices` or
 * `/api/networks` prefix. Invalidations are also coalesced, so a burst of
 * events becomes one refetch round (see `createRealtimeApplier`).
 */

const DEVICE_LIST = "/api/devices"
const NETWORK_LIST = "/api/networks"

type DeviceState = "pending" | "approved" | "blocked"
type OnlineState = "online" | "offline"
type SyncState = "not-applicable" | "in-sync" | "stale" | "error"

type RecordLike = Record<string, unknown>

interface DeviceEvent {
  deviceId: string
  networkId: string
  state: DeviceState
  online: OnlineState
  sync: SyncState
  hostname: string
  virtualIpv4: string | null
  lastSeenAt: string | null
  desiredRevision: number | null
  appliedRevision: number | null
  appliedAt?: string | null
  lastPushAt?: string | null
  lastPushError: string | null
  reason: string
  changed?: string[]
}

interface WireguardStatus {
  clientId: string
  state: string
  endpoint: string | null
  tunnelIp: string | null
  peerId: number | null
  error: string | null
  statusAt: string | null
}

/**
 * Invalidation targets. They are compared against the generated query keys
 * (`["/api/..."]`) rather than thrown at `invalidateQueries` one by one, so a
 * flush is a single cache pass and `refetchType: "active"` only touches what
 * is on screen.
 */
const targets = {
  networks: () => "networks",
  networkSettings: (id: string) => `network-settings:${id}`,
  networkRoutes: (id: string) => `network-routes:${id}`,
  networkPeers: (id: string) => `network-peers:${id}`,
  networkPolicy: (id: string) => `network-policy:${id}`,
  networkDns: (id: string) => `network-dns:${id}`,
  networkWireguard: (id: string) => `network-wireguard:${id}`,
  networkDevices: (id: string) => `network-devices:${id}`,
  allDevices: () => "all-devices",
  device: (id: string) => `device:${id}`,
  deviceDetail: (id: string) => `device-detail:${id}`,
  deviceRevisions: (id: string) => `device-revisions:${id}`,
  deviceRoutes: (id: string) => `device-routes:${id}`,
  wireguardClient: (id: string) => `wireguard-client:${id}`,
  tags: () => "tags",
  userGroups: () => "user-groups",
  policyAll: () => "policy-all",
} as const

function pathOf(query: Query): string | null {
  const first = query.queryKey[0]
  return typeof first === "string" ? first : null
}

function paramsOf(query: Query): RecordLike | null {
  const second = query.queryKey[1]
  return second !== null && typeof second === "object" && !Array.isArray(second)
    ? (second as RecordLike)
    : null
}

/** Network of a `/api/devices/:id[/...]` query, read from the cached detail. */
function deviceNetworkOf(
  queryClient: QueryClient,
  deviceId: string
): string | null {
  const cached = queryClient.getQueryData<{ data?: { networkId?: string } }>([
    `${DEVICE_LIST}/${deviceId}`,
  ])
  return cached?.data?.networkId ?? null
}

function matches(
  queryClient: QueryClient,
  query: Query,
  target: string
): boolean {
  const path = pathOf(query)
  if (path === null) return false
  switch (target) {
    case "networks":
      return path === NETWORK_LIST
    case "all-devices":
      return path === DEVICE_LIST || path.startsWith(`${DEVICE_LIST}/`)
    case "tags":
      return path === "/api/tags" || path.startsWith("/api/tags/")
    case "user-groups":
      return path === "/api/user-groups" || path.startsWith("/api/user-groups/")
    case "policy-all":
      return (
        path.startsWith(`${NETWORK_LIST}/`) && path.split("/")[4] === "policy"
      )
  }

  const separator = target.indexOf(":")
  if (separator === -1) return false
  const kind = target.slice(0, separator)
  const id = target.slice(separator + 1)

  switch (kind) {
    case "network-settings":
      return path === `${NETWORK_LIST}/${id}`
    case "network-routes":
      return path === `${NETWORK_LIST}/${id}/routes`
    case "network-peers":
      return path === `${NETWORK_LIST}/${id}/peers`
    case "network-policy":
      return path.startsWith(`${NETWORK_LIST}/${id}/policy`)
    case "network-dns":
      return path === `${NETWORK_LIST}/${id}/dns`
    case "network-wireguard":
      return path === `${NETWORK_LIST}/${id}/wireguard-clients`
    case "network-devices": {
      if (path === DEVICE_LIST) {
        const params = paramsOf(query)
        // A list without a network filter is the all-devices table and is
        // affected by every network's device changes.
        return params?.networkId === undefined || params.networkId === id
      }
      if (!path.startsWith(`${DEVICE_LIST}/`)) return false
      const deviceId = path.split("/")[3]
      return (
        deviceId !== undefined && deviceNetworkOf(queryClient, deviceId) === id
      )
    }
    case "device":
      return (
        path === `${DEVICE_LIST}/${id}` ||
        path.startsWith(`${DEVICE_LIST}/${id}/`)
      )
    case "device-detail":
      return path === `${DEVICE_LIST}/${id}`
    case "device-revisions":
      return path === `${DEVICE_LIST}/${id}/revisions`
    case "device-routes":
      return path === `${DEVICE_LIST}/${id}/routes`
    case "wireguard-client":
      return (
        path === `/api/wireguard-clients/${id}` ||
        path.startsWith(`/api/wireguard-clients/${id}/`)
      )
    default:
      return false
  }
}

function invalidateTargets(
  queryClient: QueryClient,
  targetsToInvalidate: Iterable<string>
): void {
  const list = new Set(targetsToInvalidate)
  if (list.size === 0) return
  void queryClient.invalidateQueries({
    predicate: (query) =>
      [...list].some((target) => matches(queryClient, query, target)),
    // Queries nobody observes are marked stale (and refetched when mounted)
    // but do not cause a background request now.
    refetchType: "active",
  })
}

function has(data: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key)
}

function patchDevice<T extends RecordLike>(device: T, data: DeviceEvent): T {
  const next = { ...device } as RecordLike
  if (has(data, "state")) next.state = data.state
  if (has(data, "online")) next.online = data.online
  if (has(data, "sync")) next.sync = data.sync
  if (has(data, "virtualIpv4")) {
    next.virtualIpv4 = data.virtualIpv4
  }
  if (has(data, "lastSeenAt")) {
    next.lastSeenAt = data.lastSeenAt
  }
  if (has(data, "desiredRevision")) {
    next.desiredRevision = data.desiredRevision
  }
  if (has(data, "appliedRevision")) {
    next.appliedRevision = data.appliedRevision
  }
  if (has(data, "appliedAt")) {
    next.appliedAt = data.appliedAt ?? device.appliedAt ?? null
  }
  if (has(data, "lastPushAt")) {
    next.lastPushAt = data.lastPushAt ?? device.lastPushAt ?? null
  }
  if (has(data, "lastPushError")) {
    next.lastPushError = data.lastPushError
  }
  // `label` is the server's `state/online/sync` combination.
  next.label = `${next.state}/${next.online}/${next.sync}`
  // Never patch `hostname`: the event carries the display name
  // (`dnsName ?? hostname`), while the DTO keeps the reported hostname and the
  // DNS name separately. A renamed device is invalidated instead.
  return next as T
}

function patchDeviceCaches(queryClient: QueryClient, data: DeviceEvent): void {
  patchDeviceLists(queryClient, data)
  queryClient.setQueriesData<{ data?: RecordLike } | undefined>(
    {
      predicate: (query) => pathOf(query) === `${DEVICE_LIST}/${data.deviceId}`,
    },
    (previous) =>
      previous?.data
        ? { ...previous, data: patchDevice(previous.data, data) }
        : previous
  )
}

function patchDeviceLists(queryClient: QueryClient, data: DeviceEvent): void {
  queryClient.setQueriesData<{ data?: RecordLike[] } | undefined>(
    { predicate: (query) => pathOf(query) === DEVICE_LIST },
    (previous) => {
      if (!Array.isArray(previous?.data)) return previous
      if (!previous.data.some((item) => item.id === data.deviceId)) {
        return previous
      }
      return {
        ...previous,
        data: previous.data.map((item) =>
          item.id === data.deviceId ? patchDevice(item, data) : item
        ),
      }
    }
  )
}

function removeDeviceCaches(queryClient: QueryClient, deviceId: string): void {
  queryClient.setQueriesData<{ data?: RecordLike[] } | undefined>(
    { predicate: (query) => pathOf(query) === DEVICE_LIST },
    (previous) => {
      if (!Array.isArray(previous?.data)) return previous
      if (!previous.data.some((item) => item.id === deviceId)) return previous
      return {
        ...previous,
        data: previous.data.filter((item) => item.id !== deviceId),
      }
    }
  )
  queryClient.removeQueries({
    predicate: (query) => {
      const path = pathOf(query)
      return (
        path === `${DEVICE_LIST}/${deviceId}` ||
        path?.startsWith(`${DEVICE_LIST}/${deviceId}/`) === true
      )
    },
  })
}

function patchWireguardStatuses(
  queryClient: QueryClient,
  networkId: string,
  statuses: WireguardStatus[]
): void {
  const byId = new Map(statuses.map((status) => [status.clientId, status]))
  const patch = <T extends RecordLike>(client: T): T => {
    const status = byId.get(String(client.id))
    if (!status) return client
    return {
      ...client,
      state: status.state,
      endpoint: status.endpoint,
      tunnelIp: status.tunnelIp,
      peerId: status.peerId,
      error: status.error,
      statusAt: status.statusAt,
    }
  }
  queryClient.setQueriesData<{ data?: RecordLike[] } | undefined>(
    {
      predicate: (query) =>
        pathOf(query) === `${NETWORK_LIST}/${networkId}/wireguard-clients`,
    },
    (previous) =>
      Array.isArray(previous?.data)
        ? { ...previous, data: previous.data.map(patch) }
        : previous
  )
  for (const status of statuses) {
    queryClient.setQueriesData<{ data?: RecordLike } | undefined>(
      {
        predicate: (query) =>
          pathOf(query) === `/api/wireguard-clients/${status.clientId}`,
      },
      (previous) =>
        previous?.data ? { ...previous, data: patch(previous.data) } : previous
    )
  }
}

/** Returns the invalidation targets produced by one event. */
function processEvent(
  queryClient: QueryClient,
  event: RealtimeEvent
): Set<string> {
  const result = new Set<string>()
  const data = event.data as RecordLike
  const networkId =
    typeof data.networkId === "string"
      ? data.networkId
      : typeof event.networkId === "string"
        ? event.networkId
        : ""

  switch (event.type) {
    case "device.updated": {
      const device = data as unknown as DeviceEvent
      const deviceId = device.deviceId || event.deviceId || ""
      patchDeviceCaches(queryClient, device)
      const changed = new Set(device.changed ?? [])
      const reason = device.reason ?? ""

      // Membership, counts and credentials: the payload cannot express those,
      // so the one network's tables (and the networks list) are refetched.
      if (changed.has("state")) {
        result.add(targets.networks())
        result.add(targets.networkSettings(networkId))
        result.add(targets.networkDevices(networkId))
      }
      // Online anchors / warnings live on the network detail DTO.
      if (changed.has("online")) {
        result.add(targets.networkSettings(networkId))
      }
      // The event's hostname is the display name; the DTO also holds the
      // reported hostname, so this is not patchable.
      if (changed.has("hostname")) {
        result.add(targets.device(deviceId))
        result.add(targets.networkDevices(networkId))
      }

      switch (reason) {
        case "heartbeat":
          break
        case "joined":
          result.add(targets.networks())
          result.add(targets.networkSettings(networkId))
          result.add(targets.networkDevices(networkId))
          break
        case "approved":
          result.add(targets.networks())
          result.add(targets.networkSettings(networkId))
          result.add(targets.networkDevices(networkId))
          result.add(targets.device(deviceId))
          result.add(targets.deviceRevisions(deviceId))
          break
        case "blocked":
          result.add(targets.networks())
          result.add(targets.networkSettings(networkId))
          result.add(targets.networkDevices(networkId))
          result.add(targets.networkPeers(networkId))
          result.add(targets.device(deviceId))
          break
        case "renamed":
          result.add(targets.device(deviceId))
          result.add(targets.networkDevices(networkId))
          result.add(targets.networkDns(networkId))
          break
        case "tags-updated":
          result.add(targets.device(deviceId))
          result.add(targets.networkDevices(networkId))
          result.add(targets.tags())
          break
        case "description-updated":
        case "owner-updated":
          result.add(targets.device(deviceId))
          result.add(targets.networkDevices(networkId))
          break
        case "endpoints-updated":
        case "hub-updated":
          result.add(targets.device(deviceId))
          result.add(targets.networkDevices(networkId))
          result.add(targets.networkPeers(networkId))
          result.add(targets.networkSettings(networkId))
          break
        case "credential-renewed":
          result.add(targets.device(deviceId))
          result.add(targets.networkSettings(networkId))
          break
        case "revision-created":
        case "rollback":
          result.add(targets.deviceDetail(deviceId))
          result.add(targets.deviceRevisions(deviceId))
          break
        case "config-pushed":
        case "config-push-failed":
          result.add(targets.deviceDetail(deviceId))
          break
        case "session-closed":
          break
        default:
          if (changed.size === 0) {
            // An explicit reason with unchanged status fields (description,
            // owner, tags, …) still means the DTO changed somewhere the event
            // does not carry.
            result.add(targets.device(deviceId))
            result.add(targets.networkDevices(networkId))
          }
      }
      return result
    }
    case "device.removed": {
      const deviceId =
        (data.deviceId as string | undefined) ?? event.deviceId ?? ""
      removeDeviceCaches(queryClient, deviceId)
      result.add(targets.networks())
      result.add(targets.networkSettings(networkId))
      result.add(targets.networkDevices(networkId))
      result.add(targets.networkPeers(networkId))
      return result
    }
    case "network.updated": {
      const reason = typeof data.reason === "string" ? data.reason : ""
      if (reason === "created" || reason === "imported") {
        // Nothing scoped to a brand-new network is cached yet.
        result.add(targets.networks())
        return result
      }
      if (reason === "hub-public-address-updated") {
        result.add(targets.networkSettings(networkId))
        result.add(targets.networkDevices(networkId))
        return result
      }
      if (reason.startsWith("credential:")) {
        result.add(targets.networkSettings(networkId))
        result.add(targets.networkDevices(networkId))
        return result
      }
      if (
        reason === "peer-added" ||
        reason === "peer-linked" ||
        reason === "peer-removed"
      ) {
        result.add(targets.networkSettings(networkId))
        result.add(targets.networkPeers(networkId))
        result.add(targets.networkDevices(networkId))
        return result
      }
      // Name, CIDR, MagicDNS, rendezvous, p2p/secret and access-mode changes:
      // only this network and its devices.
      result.add(targets.networks())
      result.add(targets.networkSettings(networkId))
      result.add(targets.networkDevices(networkId))
      result.add(targets.networkDns(networkId))
      result.add(targets.networkPeers(networkId))
      result.add(targets.networkPolicy(networkId))
      return result
    }
    case "network.deleted": {
      queryClient.removeQueries({
        predicate: (query) => {
          const path = pathOf(query)
          return (
            path === `${NETWORK_LIST}/${networkId}` ||
            path?.startsWith(`${NETWORK_LIST}/${networkId}/`) === true
          )
        },
      })
      result.add(targets.networks())
      result.add(targets.allDevices())
      return result
    }
    case "policy.updated": {
      result.add(targets.networks())
      result.add(targets.networkSettings(networkId))
      result.add(targets.networkPolicy(networkId))
      result.add(targets.networkDevices(networkId))
      return result
    }
    case "tag.updated":
    case "user_group.updated": {
      result.add(targets.tags())
      result.add(targets.userGroups())
      result.add(targets.policyAll())
      result.add(targets.allDevices())
      return result
    }
    case "route.updated": {
      const deviceId =
        typeof data.deviceId === "string" ? data.deviceId : undefined
      result.add(targets.networkRoutes(networkId))
      result.add(targets.networkDevices(networkId))
      if (deviceId) {
        result.add(targets.device(deviceId))
        result.add(targets.deviceRoutes(deviceId))
      }
      return result
    }
    case "wireguard.updated": {
      const clientId =
        typeof data.clientId === "string" ? data.clientId : undefined
      const hubDeviceId =
        typeof data.hubDeviceId === "string" ? data.hubDeviceId : undefined
      const statuses = Array.isArray(data.statuses)
        ? (data.statuses as WireguardStatus[])
        : []
      const reason = typeof data.reason === "string" ? data.reason : ""
      if (statuses.length > 0) {
        patchWireguardStatuses(queryClient, networkId, statuses)
      }
      // A pure status probe is fully represented by the payload.
      if (reason === "status" && statuses.length > 0) return result
      result.add(targets.networkWireguard(networkId))
      result.add(targets.networkDevices(networkId))
      if (clientId) result.add(targets.wireguardClient(clientId))
      if (hubDeviceId) result.add(targets.device(hubDeviceId))
      return result
    }
    case "topology.updated": {
      patchTopology(queryClient, event)
      return result
    }
    case "hello":
    case "resync":
      return result
  }
}

function patchTopology(queryClient: QueryClient, event: RealtimeEvent): void {
  const data = event.data as {
    networkId?: string
    collectedAt?: string
    nodes?: unknown[]
    links?: unknown[]
    stats?: unknown
  }
  if (!data.networkId) return
  const prefix = `${NETWORK_LIST}/${data.networkId}/topology`
  queryClient.setQueriesData<{ data?: RecordLike } | undefined>(
    {
      predicate: (query) =>
        pathOf(query) === prefix ||
        pathOf(query)?.startsWith(`${prefix}/`) === true,
    },
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
}

/** Applies one event immediately, without coalescing (tests and one-offs). */
export function applyRealtimeEvent(
  queryClient: QueryClient,
  event: RealtimeEvent
): void {
  invalidateTargets(queryClient, processEvent(queryClient, event))
}

export interface RealtimeApplierOptions {
  /** Trailing debounce window for invalidations. */
  coalesceMs?: number
  /** Override for tests; defaults to `document.visibilityState === "hidden"`. */
  isHidden?: () => boolean
}

export interface RealtimeApplier {
  apply: (event: RealtimeEvent) => void
  /** Runs pending invalidations now (unless the tab is hidden). */
  flush: () => void
  /** Drops pending work (used before a full resync invalidation). */
  clear: () => void
  dispose: () => void
  readonly pendingSize: number
}

/**
 * Coalescing front-end for `applyRealtimeEvent`.
 *
 * Events patch the cache immediately, but invalidations are collected in a
 * `Set` and flushed once after a short trailing window. A burst of six device
 * events therefore produces one refetch round instead of six. While the tab is
 * hidden nothing is flushed; the visibility listener flushes on return.
 */
export function createRealtimeApplier(
  queryClient: QueryClient,
  options: RealtimeApplierOptions = {}
): RealtimeApplier {
  const coalesceMs = options.coalesceMs ?? 350
  const isHidden =
    options.isHidden ??
    (() =>
      typeof document !== "undefined" && document.visibilityState === "hidden")
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancelTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const flush = () => {
    cancelTimer()
    if (pending.size === 0) return
    if (isHidden()) return
    const current = pending
    pending = new Set()
    invalidateTargets(queryClient, current)
  }

  const schedule = () => {
    cancelTimer()
    timer = setTimeout(flush, coalesceMs)
  }

  const clear = () => {
    cancelTimer()
    pending = new Set()
  }

  const onVisibilityChange = () => {
    if (!isHidden()) flush()
  }
  const hasDocument = typeof document !== "undefined"
  if (hasDocument) {
    document.addEventListener("visibilitychange", onVisibilityChange)
  }

  return {
    apply(event) {
      if (event.type === "resync") {
        // The provider is about to invalidate everything; pending subset work
        // would only add a second refetch round.
        clear()
        return
      }
      for (const target of processEvent(queryClient, event)) {
        pending.add(target)
      }
      if (pending.size > 0) schedule()
    },
    flush,
    clear,
    dispose() {
      cancelTimer()
      pending = new Set()
      if (hasDocument) {
        document.removeEventListener("visibilitychange", onVisibilityChange)
      }
    },
    get pendingSize() {
      return pending.size
    },
  }
}
