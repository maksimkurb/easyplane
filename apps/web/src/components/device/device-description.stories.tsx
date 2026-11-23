import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  DeviceDescriptionLine,
  DeviceDescriptionSummary,
} from "@/components/device/device-description"

const meta = {
  title: "Components/Device/DeviceDescription",
  component: DeviceDescriptionSummary,
  args: {
    description:
      "RAID storage and nightly Time Machine backups for the whole flat.",
  },
  render: (args) => (
    <div className="max-w-md">
      <DeviceDescriptionSummary {...args} />
    </div>
  ),
} satisfies Meta<typeof DeviceDescriptionSummary>

export default meta
type Story = StoryObj<typeof meta>

export const Summary: Story = {}

export const SummaryEmpty: Story = { args: { description: null } }

export const SummaryLong: Story = {
  args: {
    description:
      "A very long description that must truncate on one line in the row and show the full text in the tooltip instead of pushing the status column off-screen on a phone.",
  },
}

export const EditableLine: Story = {
  render: (args) => (
    <div className="max-w-md">
      <DeviceDescriptionLine
        canManage
        description={args.description}
        deviceId="dev-nas-01"
      />
    </div>
  ),
}

export const EmptyEditableLine: Story = {
  render: () => (
    <div className="max-w-md">
      <DeviceDescriptionLine canManage description={null} deviceId="dev-nas-01" />
    </div>
  ),
}

export const ReadOnlyLine: Story = {
  render: () => (
    <div className="max-w-md">
      <DeviceDescriptionLine
        canManage={false}
        description="Alle Geräte im Wohnzimmer laufen über den NAS."
        deviceId="dev-nas-01"
      />
    </div>
  ),
}

export const ReadOnlyEmpty: Story = {
  render: () => (
    <div className="max-w-md rounded-lg border border-dashed p-3 text-sm text-fg-3">
      A read-only user sees nothing when there is no description:
      <DeviceDescriptionLine canManage={false} description={null} deviceId="dev-nas-01" />
    </div>
  ),
}
