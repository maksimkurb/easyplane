import type { Meta, StoryObj } from "@storybook/react-vite"

import { SetupChecklist } from "@/components/network/setup-checklist"
import { homeDevices } from "../../../.storybook/fixtures/devices"
import { primaryNetwork } from "../../../.storybook/fixtures/networks"

const meta = {
  title: "Network/SetupChecklist",
  component: SetupChecklist,
  args: {
    network: primaryNetwork,
    devices: homeDevices,
    openAddDevice: () => undefined,
  },
  render: (args) => (
    <div className="max-w-2xl">
      <SetupChecklist {...args} />
    </div>
  ),
} satisfies Meta<typeof SetupChecklist>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const EmptyNetwork: Story = {
  args: { devices: [] },
  render: (args) => (
    <div className="max-w-2xl">
      <SetupChecklist {...args} />
    </div>
  ),
}
