/**
 * AmneziaWG obfuscation for a plain WireGuard config.
 *
 * EasyTier's portal is vanilla WireGuard. Of the AmneziaWG parameters only the
 * sender-side junk packets (Jc, Jmin, Jmax) are safe against a vanilla peer:
 * the extra packets precede the handshake and are discarded by it. S1/S2 and
 * H1-H4 change the wire format and must match on both ends, so they are left
 * at their defaults and never emitted.
 */
export interface AwgParams {
  jc: number
  jmin: number
  jmax: number
}

function randomInt(min: number, max: number): number {
  const range = max - min + 1
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return min + (buffer[0] % range)
}

/** Recommended ranges: Jc 4-12, Jmin 8-64, Jmax Jmin+32..Jmin+300 (<= 1280). */
export function randomAwgParams(): AwgParams {
  const jmin = randomInt(8, 64)
  const jmax = Math.min(1280, randomInt(jmin + 32, jmin + 300))
  return { jc: randomInt(4, 12), jmin, jmax }
}

/** Inserts the parameters right after `[Interface]`, replacing existing ones. */
export function applyAwgParams(config: string, params: AwgParams): string {
  const cleaned = config
    .split("\n")
    .filter((line) => !/^\s*(Jc|Jmin|Jmax)\s*=/i.test(line))
    .join("\n")
  return cleaned.replace(
    /^(\s*\[Interface\][^\n]*\n)/im,
    `$1Jc = ${params.jc}\nJmin = ${params.jmin}\nJmax = ${params.jmax}\n`
  )
}

/** Host of the first `Endpoint = host:port` line, brackets removed. */
export function endpointHost(config: string | null): string {
  const match = config ? /^\s*Endpoint\s*=\s*(\[[^\]]+\]|[^:\s]+)/im.exec(config) : null
  return match?.[1]?.replace(/^\[|\]$/g, "") ?? ""
}

/** Replaces the host of every `Endpoint` line, keeping the port. */
export function applyEndpointHost(config: string, host: string): string {
  const value = host.trim()
  if (!value) return config
  const target = value.includes(":") && !value.startsWith("[") ? `[${value}]` : value
  return config.replace(
    /^(\s*Endpoint\s*=\s*)(?:\[[^\]]+\]|[^:\s]+)(:\d+\s*)$/gim,
    (_line, prefix: string, port: string) => `${prefix}${target}${port}`
  )
}

/** Browser download of a text config, without touching the server. */
export function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Sends every IPv4 packet through the tunnel: the hub forwards non-mesh
 * traffic to its exit node. Only the `[Peer]` section's `AllowedIPs` changes.
 */
export function applyFullTunnel(config: string): string {
  return config.replace(
    /^(\s*AllowedIPs\s*=).*$/gim,
    "$1 0.0.0.0/0"
  )
}
