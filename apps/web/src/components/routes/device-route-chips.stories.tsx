import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceRouteChips } from "@/components/routes/device-route-chips"
import { deviceRoutes } from "../../../.storybook/fixtures/devices"

const meta = {
  title: "Routes/DeviceRouteChips",
  component: DeviceRouteChips,
  args: { routes: deviceRoutes },
} satisfies Meta<typeof DeviceRouteChips>

export default meta
type Story = StoryObj<typeof meta>

export const ApprovedSubnetAndExit: Story = {}

export const ProposedExitNode: Story = {
  args: {
    routes: deviceRoutes.map((route) =>
      route.kind === "exit_node" ? { ...route, state: "pending" } : route
    ),
  },
}

export const SubnetOnly: Story = {
  args: { routes: deviceRoutes.filter((route) => route.kind === "subnet") },
}

export const None: Story = {
  args: { routes: [] },
  render: (args) => (
    <p className="text-sm text-fg-3">
      Renders nothing: <DeviceRouteChips {...args} />
    </p>
  ),
}
