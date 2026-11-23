import type { Meta, StoryObj } from "@storybook/react-vite"

import { OsIcon } from "@/components/os-icon/os-icon"
import { OS_GLYPHS, type OsGlyphId } from "@/components/os-icon/os-icons"
import { resolveOs, type DeviceOs } from "@/components/os-icon/resolve-os"

/**
 * A sample reported OS per glyph. The gallery renders every glyph in
 * `OS_GLYPHS` and shows the id `resolveOs()` returns for that sample, so a
 * change to the matching table is visible in one screenshot.
 */
const SAMPLES: Record<OsGlyphId, { os: DeviceOs; hostname?: string }> = {
  android: { os: { type: "android", distribution: "Android", version: "15" } },
  ios: { os: { type: "ios", distribution: "iOS", version: "18.2" } },
  macos: { os: { type: "macos", distribution: "macOS Sequoia", version: "15.1" } },
  windows: { os: { type: "windows", distribution: "Windows 11 Pro", version: "24H2" } },
  linux: { os: { type: "linux", distribution: "Linux", version: "6.8" } },
  openwrt: { os: { type: "linux", distribution: "OpenWrt", version: "23.05" } },
  debian: { os: { type: "linux", distribution: "Debian GNU/Linux", version: "12" } },
  ubuntu: { os: { type: "linux", distribution: "Ubuntu", version: "24.04" } },
  fedora: { os: { type: "linux", distribution: "Fedora Server", version: "41" } },
  arch: { os: { type: "linux", distribution: "Arch Linux", version: "rolling" } },
  alpine: { os: { type: "linux", distribution: "Alpine Linux", version: "3.20" } },
  nixos: { os: { type: "linux", distribution: "NixOS", version: "24.11" } },
  bsd: { os: { type: "freebsd", distribution: "FreeBSD", version: "14.2" } },
  raspberrypi: { os: { type: "linux", distribution: "Raspberry Pi OS", version: "12" } },
  docker: { os: { type: "linux", distribution: "Docker", version: "27" } },
}

const rows = (Object.keys(OS_GLYPHS) as OsGlyphId[]).map((glyph) => ({
  glyph,
  title: OS_GLYPHS[glyph].title,
  sample: SAMPLES[glyph],
  resolved: resolveOs(SAMPLES[glyph].os, SAMPLES[glyph].hostname),
}))

const meta = {
  title: "Components/OsIcon",
  component: OsIcon,
  args: { os: SAMPLES.debian.os, className: "size-6" },
} satisfies Meta<typeof OsIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Gallery: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((row) => (
        <div
          className="flex min-w-0 items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-line"
          key={row.glyph}
        >
          <span className="grid size-10 flex-none place-items-center rounded-lg bg-surface-2 text-fg-2 ring-1 ring-line">
            <OsIcon {...args} label={row.title} os={row.sample.os} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.title}</p>
            <p className="truncate font-mono text-[11px] text-fg-3">
              {row.glyph === row.resolved ? row.glyph : `resolved: ${row.resolved}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  ),
}

export const HostnameResolution: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-3">
      {[
        { os: { type: "", distribution: "" }, hostname: "macbook-pro" },
        { os: { type: "", distribution: "" }, hostname: "rpi-sensor" },
        { os: { type: "", distribution: "" }, hostname: "openwrt-gw" },
        { os: { type: "", distribution: "" }, hostname: "kiosk-01" },
      ].map((sample) => (
        <div
          className="flex w-52 items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-line"
          key={sample.hostname}
        >
          <OsIcon {...args} os={sample.os} />
          <div className="min-w-0">
            <p className="truncate text-sm">{sample.hostname}</p>
            <p className="truncate font-mono text-[11px] text-fg-3">
              {resolveOs(sample.os, sample.hostname) ?? "fallback icon"}
            </p>
          </div>
        </div>
      ))}
    </div>
  ),
}
