import type { ListDevices200Item } from "@/api/generated/model"

export type DeviceKind =
  | "phone"
  | "router"
  | "server"
  | "windows"
  | "laptop"
  | "terminal"

/**
 * EasyTier reports the OS, not a device class, so the icon is a best-effort
 * hint (a Debian box is drawn as a server). The hostname is always next to it.
 */
export function deviceKind(os: {
  type?: string | null
  distribution?: string | null
}): DeviceKind {
  const haystack = `${os.distribution ?? ""} ${os.type ?? ""}`.toLowerCase()
  if (/(android|ios|iphone|ipad)/.test(haystack)) return "phone"
  if (/(rasp|openwrt|router|lede)/.test(haystack)) return "router"
  if (/(debian|ubuntu|centos|fedora|alpine|linux)/.test(haystack)) return "server"
  if (/windows/.test(haystack)) return "windows"
  if (/(macos|darwin|os x)/.test(haystack)) return "laptop"
  return "terminal"
}

export function osLabel(os: {
  type?: string | null
  distribution?: string | null
  version?: string | null
}): string {
  const name = os.distribution || os.type
  if (!name) return "—"
  return os.version ? `${name} ${os.version}` : name
}

/** A row needs attention when something is blocked, stale or failed. */
export function deviceHasIssue(device: ListDevices200Item): boolean {
  return (
    device.state === "blocked" ||
    device.sync === "stale" ||
    device.sync === "error" ||
    Boolean(device.lastPushError)
  )
}

export function deviceName(device: ListDevices200Item): string {
  return device.dnsName || device.hostname || device.machineId.slice(0, 8)
}
