import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceHubCard } from "@/components/device/device-hub-card"
import { detailDevice } from "../../../.storybook/fixtures/devices"

const meta = {
  title: "Components/Device/DeviceHubCard",
  component: DeviceHubCard,
  args: { device: detailDevice },
  render: (args) => (
    <div className="max-w-2xl">
      <DeviceHubCard {...args} />
    </div>
  ),
} satisfies Meta<typeof DeviceHubCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoEndpoints: Story = {
  args: {
    device: {
      ...detailDevice,
      advertisedEndpoints: [],
      listenPort: null,
      externalPort: null,
      publicIps: [],
    },
  },
}
