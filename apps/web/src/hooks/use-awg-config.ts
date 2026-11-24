import { useMemo, useState } from "react"

import {
  applyAwgParams,
  applyEndpointHost,
  applyFullTunnel,
  endpointHost,
  randomAwgParams,
  type AwgParams,
} from "@/lib/awg"

/** Optional download tweaks: AmneziaWG junk parameters and full-tunnel routing. */
export function useAwgConfig(config: string | null) {
  const [enabled, setEnabled] = useState(false)
  const [params, setParams] = useState<AwgParams>(() => randomAwgParams())
  const [fullTunnel, setFullTunnel] = useState(false)
  const [endpoint, setEndpoint] = useState("")
  const value = useMemo(() => {
    if (!config) return config
    let result = applyEndpointHost(config, endpoint)
    if (fullTunnel) result = applyFullTunnel(result)
    if (enabled) result = applyAwgParams(result, params)
    return result
  }, [config, endpoint, enabled, fullTunnel, params])
  return {
    endpoint,
    setEndpoint,
    endpointPlaceholder: endpointHost(config),
    enabled,
    setEnabled,
    fullTunnel,
    setFullTunnel,
    params,
    regenerate: () => setParams(randomAwgParams()),
    value,
  }
}
