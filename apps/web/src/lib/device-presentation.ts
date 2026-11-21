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

/**
 * A DNS name without doubled or trailing dots. Zones are sometimes stored with
 * a trailing dot ("et.net."), which used to render "nas-01.et.net..".
 */
export function normalizeDnsName(value: string): string {
  return value.replace(/\.{2,}/g, ".").replace(/\.+$/, "")
}

/** "name" + "zone" as one FQDN, tolerant of either part already having dots. */
export function dnsFqdn(
  name: string | null | undefined,
  zone: string | null | undefined
): string {
  const host = normalizeDnsName(name ?? "")
  const suffix = normalizeDnsName(zone ?? "").replace(/^\.+/, "")
  if (!host) return suffix
  if (!suffix) return host
  return normalizeDnsName(`${host}.${suffix}`)
}
