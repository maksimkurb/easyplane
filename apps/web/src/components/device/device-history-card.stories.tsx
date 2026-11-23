import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceHistoryCard } from "@/components/device/device-history-card"
import { detailDevice } from "../../../.storybook/fixtures/devices"
import { revisions } from "../../../.storybook/fixtures/network"

const meta = {
  title: "Components/Device/DeviceHistoryCard",
  component: DeviceHistoryCard,
  args: { device: detailDevice, revisions },
  render: (args) => (
    <div className="max-w-2xl">
      <DeviceHistoryCard {...args} />
    </div>
  ),
} satisfies Meta<typeof DeviceHistoryCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { revisions: [] } }

export const SingleRevision: Story = { args: { revisions: revisions.slice(0, 1) } }
