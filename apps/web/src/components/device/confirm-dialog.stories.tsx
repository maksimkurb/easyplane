import type { Meta, StoryObj } from "@storybook/react-vite"

import { ConfirmDialog } from "@/components/device/confirm-dialog"

const meta = {
  title: "Components/Device/ConfirmDialog",
  component: ConfirmDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: "Remove nas-01?",
    description:
      "The device loses access immediately. Its configuration and history are deleted with it.",
    confirmLabel: "Remove",
    destructive: true,
    pending: false,
    onConfirm: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Destructive: Story = {}

export const Block: Story = {
  args: {
    title: "Block nas-01?",
    description: "The device keeps its data but cannot join the network.",
    confirmLabel: "Block",
    destructive: false,
  },
}

export const Pending: Story = { args: { pending: true } }

export const Closed: Story = { args: { open: false } }
