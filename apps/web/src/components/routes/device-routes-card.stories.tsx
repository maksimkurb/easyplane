import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceRoutesCard } from "@/components/routes/device-routes-card"
import { detailDevice, deviceRoutes } from "../../../.storybook/fixtures/devices"

const meta = {
  title: "Routes/DeviceRoutesCard",
  component: DeviceRoutesCard,
  args: { device: detailDevice, routes: deviceRoutes },
  render: (args) => (
    <div className="max-w-2xl">
      <DeviceRoutesCard {...args} />
    </div>
  ),
} satisfies Meta<typeof DeviceRoutesCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoRoutes: Story = { args: { routes: [] } }

export const OnlyProposed: Story = {
  args: {
    routes: deviceRoutes.map((route) => ({ ...route, state: "pending" })),
  },
}
