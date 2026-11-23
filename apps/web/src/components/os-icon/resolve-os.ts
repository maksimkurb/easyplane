import type { OsGlyphId } from "./os-icons"

/** The slice of a device's `os` the glyph depends on. */
export type DeviceOs = {
  type?: string | null
  version?: string | null
  distribution?: string | null
}

/**
 * What EasyTier reports is not a neat enum. `type` comes from the client's
 * platform ("linux", "macos", "windows", "android", "ios", "freebsd") while
 * `distribution` is free-form ("Debian GNU/Linux", "openwrt", "Arch Linux").
 * Match the distribution first because it is the more specific of the two,
 * and tolerate case, vendor suffixes and a few older spellings.
 */
const REPORTED_HINTS: ReadonlyArray<readonly [RegExp, OsGlyphId]> = [
  [/\bandroid\b/, "android"],
  [/\b(ios|ipados|iphone|ipad)\b/, "ios"],
  [/\b(macos|mac os|os ?x|darwin)\b/, "macos"],
  [/\b(windows|win32|win64|winnt)\b/, "windows"],
  [/\b(docker|podman|container)\b/, "docker"],
  [/\b(openwrt|lede)\b/, "openwrt"],
  [/\b(raspbian|raspberry ?pi ?os|raspios)\b/, "raspberrypi"],
  [/\bdebian\b/, "debian"],
  [/\bubuntu\b/, "ubuntu"],
  [/\bfedora\b/, "fedora"],
  [/\barch( ?linux)?\b/, "arch"],
  [/\balpine\b/, "alpine"],
  [/\bnixos\b/, "nixos"],
  [/\b(freebsd|openbsd|netbsd|dragonfly ?bsd)\b/, "bsd"],
  [/\blinux\b/, "linux"],
]

/**
 * Hostnames are only a hint, and only when the client reported no OS at all.
 * Keep the patterns specific: a server called "kiosk-01" must not become an
 * iPhone because "ios" appears inside the name.
 */
const HOSTNAME_HINTS: ReadonlyArray<readonly [RegExp, OsGlyphId]> = [
  [/\b(openwrt|lede)\b/, "openwrt"],
  [/\b(raspberry|raspberrypi|raspbian|raspi)\b/, "raspberrypi"],
  [/\brpi\d*\b/, "raspberrypi"],
  [/\b(freebsd|openbsd|netbsd)\b/, "bsd"],
  [/\b(iphone|ipad)\b/, "ios"],
  [/\b(android|pixel|galaxy|oneplus)\b/, "android"],
  [/\b(macbook|imac|macmini|mac-mini)\b/, "macos"],
  [/\b(nixos)\b/, "nixos"],
  [/\b(ubuntu)\b/, "ubuntu"],
  [/\b(debian)\b/, "debian"],
  [/\b(fedora)\b/, "fedora"],
  [/\b(alpine)\b/, "alpine"],
  [/\b(archlinux|arch-linux)\b/, "arch"],
  [/\b(docker|container|podman)\b/, "docker"],
]

function match(
  hints: ReadonlyArray<readonly [RegExp, OsGlyphId]>,
  haystack: string
): OsGlyphId | null {
  for (const [pattern, glyph] of hints) {
    if (pattern.test(haystack)) return glyph
  }
  return null
}

/**
 * Pick a glyph for a device. Returns `null` when the OS is unknown so callers
 * can fall back to a class icon (server / laptop / phone / router).
 *
 * A reported OS that matches nothing is *not* overridden by the hostname: the
 * client said something, we just do not have a glyph for it. Hostnames only
 * fill the gap when both `type` and `distribution` are empty.
 */
export function resolveOs(
  os: DeviceOs,
  hostname?: string | null
): OsGlyphId | null {
  const reported = `${os.distribution ?? ""} ${os.type ?? ""}`
    .toLowerCase()
    .trim()
  if (reported) return match(REPORTED_HINTS, reported)
  return match(HOSTNAME_HINTS, (hostname ?? "").toLowerCase())
}
