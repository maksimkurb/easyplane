import type { Meta, StoryObj } from "@storybook/react-vite"

import { AnchorRemovalDialog } from "@/components/anchor-removal-dialog"

const meta = {
  title: "Components/AnchorRemovalDialog",
  component: AnchorRemovalDialog,
  args: {
    open: true,
    hostname: "nas-01",
    networkId: "net-home-lab",
    operation: "block",
    useRendezvous: false,
    onClose: () => undefined,
    onConfirm: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof AnchorRemovalDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Block: Story = {}

export const Remove: Story = { args: { operation: "delete" } }

export const RendezvousWarning: Story = { args: { useRendezvous: true } }

export const Pending: Story = { args: { pending: true } }
