import { useMemo, useState } from "react"

import { applyAwgParams, randomAwgParams, type AwgParams } from "@/lib/awg"

/** Optional AmneziaWG junk-packet parameters for a downloaded config. */
export function useAwgConfig(config: string | null) {
  const [enabled, setEnabled] = useState(false)
  const [params, setParams] = useState<AwgParams>(() => randomAwgParams())
  const value = useMemo(
    () => (config && enabled ? applyAwgParams(config, params) : config),
    [config, enabled, params]
  )
  return {
    enabled,
    setEnabled,
    params,
    regenerate: () => setParams(randomAwgParams()),
    value,
  }
}
