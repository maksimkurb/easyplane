import { describe, expect, it } from "vitest"

import { resolveOs } from "@/components/os-icon/resolve-os"

describe("resolveOs", () => {
  it.each([
    [{ type: "linux", distribution: "OpenWrt" }, "openwrt"],
    [{ type: "linux", distribution: "openwrt", version: "25.12.5" }, "openwrt"],
    [{ type: "linux", distribution: "OpenWrt 23.05.5" }, "openwrt"],
    [{ type: "linux", distribution: "LEDE" }, "openwrt"],
    [{ type: "android", distribution: "Android" }, "android"],
    [{ type: "android", distribution: "Android 15" }, "android"],
    [{ type: "ios" }, "ios"],
    [{ type: "ios", distribution: "iPadOS" }, "ios"],
    [{ type: "darwin" }, "macos"],
    [{ type: "macos", distribution: "macOS 15.1" }, "macos"],
    [{ type: "macos", distribution: "OS X" }, "macos"],
    [{ type: "windows", distribution: "Windows 11" }, "windows"],
    [{ type: "win32" }, "windows"],
    [{ type: "linux", distribution: "Debian GNU/Linux" }, "debian"],
    [{ type: "linux", distribution: "debian" }, "debian"],
    [{ type: "linux", distribution: "Ubuntu" }, "ubuntu"],
    [{ type: "linux", distribution: "Ubuntu 24.04.1 LTS" }, "ubuntu"],
    [{ type: "linux", distribution: "Fedora Linux" }, "fedora"],
    [{ type: "linux", distribution: "Arch Linux" }, "arch"],
    [{ type: "linux", distribution: "arch" }, "arch"],
    [{ type: "linux", distribution: "Alpine Linux" }, "alpine"],
    [{ type: "linux", distribution: "NixOS" }, "nixos"],
    [{ type: "linux", distribution: "Raspberry Pi OS" }, "raspberrypi"],
    [{ type: "linux", distribution: "Raspbian GNU/Linux" }, "raspberrypi"],
    [{ type: "freebsd" }, "bsd"],
    [{ type: "openbsd" }, "bsd"],
    [{ type: "linux", distribution: "Docker" }, "docker"],
    [{ type: "linux" }, "linux"],
    [{ type: "linux", distribution: "Linux Mint" }, "linux"],
  ] as const)("maps %o to %s", (os, expected) => {
    expect(resolveOs(os)).toBe(expected)
  })

  it("is tolerant of case and surrounding whitespace", () => {
    expect(
      resolveOs({ type: " LINUX ", distribution: "  DEBIAN GNU/LINUX " })
    ).toBe("debian")
    expect(resolveOs({ distribution: "NixOS" })).toBe("nixos")
  })

  it("uses the hostname only when the OS is empty", () => {
    expect(resolveOs({}, "openwrt-router")).toBe("openwrt")
    expect(resolveOs({ type: null, distribution: "" }, "nas-rpi4")).toBe(
      "raspberrypi"
    )
    expect(resolveOs({}, "macbook-maxim")).toBe("macos")
    expect(resolveOs({}, "pixel-8")).toBe("android")
  })

  it("does not let a hostname override a reported OS", () => {
    expect(
      resolveOs({ type: "plan9", distribution: "Plan 9" }, "iphone-15")
    ).toBeNull()
    expect(resolveOs({ type: "linux" }, "nas-rpi4")).toBe("linux")
  })

  it("ignores hostname substrings that merely look like an OS", () => {
    expect(resolveOs({}, "kiosk-01")).toBeNull()
    expect(resolveOs({}, "archiver")).toBeNull()
  })

  it("returns null for an unknown or empty OS", () => {
    expect(resolveOs({})).toBeNull()
    expect(resolveOs({ type: "", distribution: "", version: "12" })).toBeNull()
    expect(resolveOs({ type: "plan9", distribution: "Plan 9" })).toBeNull()
  })
})
