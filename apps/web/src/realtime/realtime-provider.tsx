import { useEffect, useMemo, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { applyRealtimeEvent } from "./apply-event"
import { RealtimeContext } from "./context"
import { useEventStream } from "./use-event-stream"

/**
 * One shell-wide event stream. Pages keep using ordinary TanStack Query hooks;
 * events invalidate exactly the prefixes they touch, so a heartbeat, approval,
 * policy save or route decision shows up without a refresh.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const { status, lastSeq, resyncToken } = useEventStream({
    onEvent: (event) => applyRealtimeEvent(queryClient, event),
  })

  useEffect(() => {
    if (resyncToken === 0) return
    // The server could not replay our history (restart or a long disconnect):
    // everything on screen may be stale.
    void queryClient.invalidateQueries()
  }, [resyncToken, queryClient])

  const value = useMemo(() => ({ status, lastSeq }), [status, lastSeq])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}
