import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceIcon } from "@/components/device/device-icon"

const meta = {
  title: "Components/Device/DeviceIcon",
  component: DeviceIcon,
  args: { os: { type: "linux", distribution: "Debian GNU/Linux", version: "12" } },
  decorators: [
    (Story) => (
      <span className="grid size-12 place-items-center rounded-xl bg-surface-2 text-fg-2 ring-1 ring-line">
        <Story />
      </span>
    ),
  ],
} satisfies Meta<typeof DeviceIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Debian: Story = {}

export const EveryOs: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {[
        { type: "linux", distribution: "Debian GNU/Linux", version: "12" },
        { type: "linux", distribution: "Ubuntu", version: "24.04" },
        { type: "linux", distribution: "Fedora Server", version: "41" },
        { type: "linux", distribution: "Arch Linux", version: "rolling" },
        { type: "linux", distribution: "Alpine Linux", version: "3.20" },
        { type: "linux", distribution: "NixOS", version: "24.11" },
        { type: "linux", distribution: "Raspberry Pi OS", version: "12" },
        { type: "linux", distribution: "OpenWrt", version: "23.05" },
        { type: "windows", distribution: "Windows 11 Pro", version: "24H2" },
        { type: "macos", distribution: "macOS Sequoia", version: "15.1" },
        { type: "ios", distribution: "iOS", version: "18.2" },
        { type: "android", distribution: "Android", version: "15" },
        { type: "freebsd", distribution: "FreeBSD", version: "14.2" },
        { type: "linux", distribution: "Docker", version: "27" },
      ].map((os) => (
        <span
          className="grid size-12 place-items-center rounded-xl bg-surface-2 text-fg-2 ring-1 ring-line"
          key={`${os.type}-${os.distribution}`}
          title={`${os.distribution} ${os.version}`}
        >
          <DeviceIcon className="size-6" os={os} />
        </span>
      ))}
    </div>
  ),
}

export const UnknownOsFallback: Story = {
  args: { os: { type: "plan9", distribution: "Plan 9", version: "4" } },
}

export const HostnameHintOnly: Story = {
  args: {
    os: { type: "", distribution: "", version: "" },
    hostname: "rpi-sensor",
  },
}
