import type { Meta, StoryObj } from "@storybook/react-vite"

import { NewNetworkDialog } from "@/components/network/new-network-dialog"

const meta = {
  title: "Network/NewNetworkDialog",
  component: NewNetworkDialog,
  args: { open: true, onOpenChange: () => undefined },
  parameters: { layout: "centered" },
} satisfies Meta<typeof NewNetworkDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Closed: Story = { args: { open: false } }
