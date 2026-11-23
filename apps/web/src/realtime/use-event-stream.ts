import { useEffect, useRef, useState } from "react"

import { AUTH_REQUIRED_EVENT } from "@/api/client"
import { nextBackoffDelay } from "@/lib/realtime-backoff"

export type RealtimeEventType =
  | "hello"
  | "resync"
  | "device.updated"
  | "device.removed"
  | "network.updated"
  | "network.deleted"
  | "policy.updated"
  | "tag.updated"
  | "user_group.updated"
  | "route.updated"
  | "wireguard.updated"
  | "topology.updated"

export interface RealtimeEvent {
  seq: number
  type: RealtimeEventType
  at: string
  orgId: string
  networkId?: string
  deviceId?: string
  topics: string[]
  data: Record<string, unknown>
}

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "offline"

export interface UseEventStreamOptions {
  /** Restrict the stream to one network (the topology page does this). */
  networkId?: string
  /** Marks this stream as a topology viewer, which enables fast polling. */
  topology?: boolean
  enabled?: boolean
  /** Called for every event; a ref is used internally so it may change freely. */
  onEvent?: (event: RealtimeEvent) => void
}

export interface UseEventStreamResult {
  status: RealtimeStatus
  /** Sequence of the last received event (used for Last-Event-ID replay). */
  lastSeq: number
  /** Increments when the server could not replay history and a refetch is due. */
  resyncToken: number
}

const EVENT_TYPES: RealtimeEventType[] = [
  "hello",
  "resync",
  "device.updated",
  "device.removed",
  "network.updated",
  "network.deleted",
  "policy.updated",
  "tag.updated",
  "user_group.updated",
  "route.updated",
  "wireguard.updated",
  "topology.updated",
]

/**
 * One authenticated SSE connection with exponential backoff.
 *
 * The session cookie rides on the same-origin `EventSource` request, so no
 * token ever reaches JavaScript. The hook reconnects itself (instead of relying
 * on the browser's fixed retry) and replays history by passing the last event
 * id as a query parameter, because `EventSource` cannot set headers manually.
 */
export function useEventStream(
  options: UseEventStreamOptions = {}
): UseEventStreamResult {
  const { networkId, topology, enabled = true } = options
  const [status, setStatus] = useState<RealtimeStatus>(
    enabled ? "connecting" : "offline"
  )
  const [lastSeq, setLastSeq] = useState(0)
  const [resyncToken, setResyncToken] = useState(0)

  const handlerRef = useRef(options.onEvent)
  useEffect(() => {
    handlerRef.current = options.onEvent
  }, [options.onEvent])
  const lastSeqRef = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined

    let disposed = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const cleanupSource = () => {
      if (!source) return
      for (const type of EVENT_TYPES) {
        source.removeEventListener(type, onEvent)
      }
      source.close()
      source = null
    }

    const schedule = () => {
      if (disposed) return
      const delay = nextBackoffDelay(attempt)
      attempt += 1
      setStatus("reconnecting")
      timer = setTimeout(connect, delay)
    }

    async function probeSession(): Promise<boolean> {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
        })
        return response.ok
      } catch {
        return false
      }
    }

    function onEvent(message: Event) {
      const raw = (message as MessageEvent<string>).data
      if (!raw) return
      let event: RealtimeEvent
      try {
        event = JSON.parse(raw) as RealtimeEvent
      } catch {
        return
      }
      if (typeof event.seq === "number" && event.seq > 0) {
        lastSeqRef.current = event.seq
        setLastSeq(event.seq)
      }
      if (event.type === "resync") {
        setResyncToken((value) => value + 1)
      }
      handlerRef.current?.(event)
    }

    function connect() {
      if (disposed) return
      cleanupSource()
      const params = new URLSearchParams()
      if (networkId) params.set("networkId", networkId)
      if (topology) params.set("topology", "1")
      if (lastSeqRef.current > 0) {
        params.set("lastEventId", String(lastSeqRef.current))
      }
      const query = params.toString()
      const url = `/api/events${query ? `?${query}` : ""}`
      setStatus((current) => (current === "live" ? current : "connecting"))

      const stream = new EventSource(url, { withCredentials: true })
      source = stream

      stream.onopen = () => {
        attempt = 0
        setStatus("live")
      }

      for (const type of EVENT_TYPES) {
        stream.addEventListener(type, onEvent)
      }

      stream.onerror = () => {
        if (disposed) return
        cleanupSource()
        // A 401/403 cannot be recovered by reconnecting. The endpoint answers
        // with JSON before the stream opens; probe the session to distinguish
        // an expired login from a network error.
        void probeSession().then((ok) => {
          if (disposed) return
          if (!ok) {
            setStatus("offline")
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
            }
            return
          }
          schedule()
        })
      }
    }

    connect()

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      cleanupSource()
    }
  }, [enabled, networkId, topology])

  return {
    status: enabled ? status : "offline",
    lastSeq,
    resyncToken,
  }
}
