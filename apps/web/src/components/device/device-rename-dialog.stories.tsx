import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceRenameDialog } from "@/components/device/device-rename-dialog"

const meta = {
  title: "Components/Device/DeviceRenameDialog",
  component: DeviceRenameDialog,
  args: {
    deviceId: "dev-nas-01",
    networkId: "net-home-lab",
    currentName: "nas-01",
    zone: "home.easytier.",
    open: true,
    onOpenChange: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof DeviceRenameDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Closed: Story = { args: { open: false } }
