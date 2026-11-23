import type { Meta, StoryObj } from "@storybook/react-vite"

import { ApprovalsPanel } from "@/components/network/approvals-panel"
import { devices, homeDevices } from "../../../.storybook/fixtures/devices"
import { invites, networkRoutes } from "../../../.storybook/fixtures/network"

const meta = {
  title: "Network/ApprovalsPanel",
  component: ApprovalsPanel,
  args: {
    networkId: "net-home-lab",
    devices: homeDevices,
    routes: networkRoutes.routes,
    invites,
  },
  render: (args) => (
    <div className="max-w-3xl">
      <ApprovalsPanel {...args} />
    </div>
  ),
} satisfies Meta<typeof ApprovalsPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NothingWaiting: Story = {
  args: {
    devices: devices.filter((device) => device.state === "approved"),
    routes: networkRoutes.routes.filter((route) => route.state !== "pending"),
    invites: [],
  },
  render: (args) => (
    <div className="max-w-3xl">
      <p className="mb-2 text-sm text-fg-3">
        Renders nothing when nothing is waiting:
      </p>
      <ApprovalsPanel {...args} />
    </div>
  ),
}

export const RoutesOnly: Story = {
  args: { devices: homeDevices.filter((device) => device.state === "approved") },
}
