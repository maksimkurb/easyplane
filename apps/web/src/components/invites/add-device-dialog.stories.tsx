import type { Meta, StoryObj } from "@storybook/react-vite"

import { AddDeviceDialog } from "@/components/invites/add-device-dialog"
import { primaryNetwork, secondaryNetwork } from "../../../.storybook/fixtures/networks"

const meta = {
  title: "Invites/AddDeviceDialog",
  component: AddDeviceDialog,
  args: {
    network: primaryNetwork,
    open: true,
    onOpenChange: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof AddDeviceDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SharedSecretNetwork: Story = {
  args: { network: secondaryNetwork },
}

export const Closed: Story = { args: { open: false } }
