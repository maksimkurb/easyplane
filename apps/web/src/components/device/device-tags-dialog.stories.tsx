import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceTagsDialog } from "@/components/device/device-tags-dialog"

const meta = {
  title: "Components/Device/DeviceTagsDialog",
  component: DeviceTagsDialog,
  args: {
    deviceId: "dev-nas-01",
    deviceName: "nas-01",
    currentTags: ["tag:storage", "tag:backup"],
    open: true,
    onOpenChange: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof DeviceTagsDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoTags: Story = { args: { currentTags: [] } }
