import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceDescriptionDialog } from "@/components/device/device-description-dialog"

const meta = {
  title: "Components/Device/DeviceDescriptionDialog",
  component: DeviceDescriptionDialog,
  args: {
    deviceId: "dev-nas-01",
    currentDescription:
      "RAID storage and nightly Time Machine backups for the whole flat.",
    open: true,
    onOpenChange: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof DeviceDescriptionDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { currentDescription: null } }

export const Long: Story = {
  args: {
    currentDescription:
      "A very long description that wraps over several lines in the textarea, proving the dialog body scrolls instead of stretching past the viewport.",
  },
}
