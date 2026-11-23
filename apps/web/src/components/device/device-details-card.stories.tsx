import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceDetailsCard } from "@/components/device/device-details-card"
import { detailDevice } from "../../../.storybook/fixtures/devices"

const meta = {
  title: "Components/Device/DeviceDetailsCard",
  component: DeviceDetailsCard,
  args: { device: detailDevice, publicIp: "203.0.113.42" },
  render: (args) => (
    <div className="max-w-2xl">
      <DeviceDetailsCard {...args} />
    </div>
  ),
} satisfies Meta<typeof DeviceDetailsCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoPublicIp: Story = { args: { publicIp: null } }

export const Offline: Story = {
  args: { device: { ...detailDevice, online: "offline", lastSeenAt: new Date(Date.now() - 2 * 86_400_000).toISOString() } },
}

export const LongName: Story = {
  args: {
    device: {
      ...detailDevice,
      hostname:
        "a-very-long-hostname-that-keeps-going-beyond-any-reasonable-table-cell-width-01",
      dnsName: null,
    },
  },
}
