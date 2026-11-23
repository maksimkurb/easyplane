import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceStatusCell } from "@/components/device/device-status-cell"
import { deviceById, homeDevices } from "../../../.storybook/fixtures/devices"

const meta = {
  title: "Components/Device/DeviceStatusCell",
  component: DeviceStatusCell,
  args: { device: homeDevices[0]! },
  argTypes: { showHint: { control: "boolean" } },
} satisfies Meta<typeof DeviceStatusCell>

export default meta
type Story = StoryObj<typeof meta>

export const Online: Story = {}

export const Offline: Story = {
  args: { device: deviceById.get("dev-pixel-9")! },
}

export const OfflineWithQueuedRevision: Story = {
  args: { device: deviceById.get("dev-debian-legacy")!, showHint: true },
}

export const Updating: Story = {
  args: { device: deviceById.get("dev-desktop-win")! },
}

export const PushFailed: Story = {
  args: { device: deviceById.get("dev-kubuntu-laptop")! },
}

export const Pending: Story = {
  args: { device: deviceById.get("dev-iphone-anna")! },
}

export const Blocked: Story = {
  args: { device: deviceById.get("dev-nixos-nas")! },
}

export const Gallery: Story = {
  render: (args) => (
    <div className="grid max-w-lg gap-3">
      {homeDevices.map((device) => (
        <div className="flex items-center justify-between gap-4" key={device.id}>
          <span className="text-xs text-fg-3">{device.hostname}</span>
          <DeviceStatusCell {...args} device={device} />
        </div>
      ))}
    </div>
  ),
}
