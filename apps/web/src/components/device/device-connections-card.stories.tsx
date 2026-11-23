import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceConnectionsCard } from "@/components/device/device-connections-card"
import { topologyLinks, topologyNodes } from "../../../.storybook/fixtures/network"

const meta = {
  title: "Components/Device/DeviceConnectionsCard",
  component: DeviceConnectionsCard,
  args: {
    networkId: "net-home-lab",
    deviceId: "dev-nas-01",
    nodes: topologyNodes,
    links: topologyLinks,
    loading: false,
  },
  render: (args) => (
    <div className="max-w-2xl">
      <DeviceConnectionsCard {...args} />
    </div>
  ),
} satisfies Meta<typeof DeviceConnectionsCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Loading: Story = { args: { loading: true } }

export const NoConnections: Story = {
  args: { deviceId: "dev-kiosk", nodes: topologyNodes, links: [] },
}
