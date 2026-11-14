/**
 * Invite URLs are the EasyTier config-server URL with the invite token as the
 * last path segment (verified against easytier-core 2.6.4: the client
 * percent-decodes it and also sends it as HeartbeatRequest.user_token).
 *
 * CLI flags verified in the pinned EasTier sources (`easytier/src/core.rs`):
 * `--config-server` / `-w` and `--hostname`.
 */
export function normalizeConfigServerBase(base: string): string {
  let value = base.trim().replace(/\/+$/, "")
  if (value === "") value = "wss://localhost"
  if (value.startsWith("https://")) value = `wss://${value.slice("https://".length)}`
  else if (value.startsWith("http://")) value = `ws://${value.slice("http://".length)}`
  else if (!/^(ws|wss|tcp|udp):\/\//.test(value)) value = `wss://${value}`
  return value
}

export function buildInviteUrl(base: string, token: string): string {
  return `${normalizeConfigServerBase(base)}/${encodeURIComponent(token)}`
}

export function buildEasytierCommand(options: {
  base: string
  token: string
  hostname?: string
}): string {
  const hostname = options.hostname?.trim() || "<hostname>"
  return `easytier-core --config-server ${buildInviteUrl(options.base, options.token)} --hostname ${hostname}`
}
