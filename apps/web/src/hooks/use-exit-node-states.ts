import { useMemo } from "react"

import { useListNetworkRoutes } from "@/api/generated/easyplane"
import type { ExitNodeState } from "@/components/exit-node-badge"

/**
 * Exit-node state per device id for one network: `approved` once an admin
 * approved the exit-node route, `proposed` while a device-declared one waits.
 * Approval is consent only (docs/POLICY.md §7.1).
 */
export function useExitNodeStates(networkId: string): Record<string, ExitNodeState> {
  const routesQuery = useListNetworkRoutes(networkId || "", {
    query: { enabled: Boolean(networkId) },
  })
  return useMemo(() => {
    const states: Record<string, ExitNodeState> = {}
    for (const route of routesQuery.data?.data.routes ?? []) {
      if (route.kind !== "exit_node" || route.state === "rejected") continue
      if (route.state === "approved") states[route.deviceId] = "approved"
      else if (route.source === "device_declared" && states[route.deviceId] !== "approved") {
        states[route.deviceId] = "proposed"
      }
    }
    return states
  }, [routesQuery.data])
}
