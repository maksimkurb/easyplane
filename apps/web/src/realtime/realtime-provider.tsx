import { useEffect, useMemo, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/auth/auth-context"
import { createRealtimeApplier } from "./apply-event"
import { RealtimeContext } from "./context"
import { useEventStream } from "./use-event-stream"

/**
 * One shell-wide event stream. Pages keep using ordinary TanStack Query hooks;
 * events patch the cache in place where the payload suffices and coalesce the
 * remaining narrow invalidations into one refetch round, so an idle page makes
 * no requests at all.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { me } = useAuth()

  const applier = useMemo(
    () => createRealtimeApplier(queryClient),
    [queryClient]
  )
  useEffect(() => () => applier.dispose(), [applier])

  const { status, lastSeq, resyncToken } = useEventStream({
    // Do not open a stream on the login screen: there is no session yet.
    enabled: Boolean(me),
    onEvent: applier.apply,
  })

  useEffect(() => {
    if (resyncToken === 0) return
    // The server could not replay our history (restart or a long disconnect):
    // everything on screen may be stale. One full invalidation, not a poll.
    applier.clear()
    void queryClient.invalidateQueries()
  }, [resyncToken, queryClient, applier])

  const value = useMemo(() => ({ status, lastSeq }), [status, lastSeq])
  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
}
