import { createContext, useContext } from "react"

import type { RealtimeStatus } from "./use-event-stream"

export interface RealtimeContextValue {
  status: RealtimeStatus
  lastSeq: number
}

export const RealtimeContext = createContext<RealtimeContextValue>({
  status: "offline",
  lastSeq: 0,
})

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext)
}
