import type { Meta, StoryObj } from "@storybook/react-vite"

import { NetworkSecuritySettings } from "@/components/network/network-security-card"
import { primaryNetwork, secondaryNetwork } from "../../../.storybook/fixtures/networks"

const meta = {
  title: "Network/NetworkSecuritySettings",
  component: NetworkSecuritySettings,
  args: { network: primaryNetwork },
  render: (args) => (
    <div className="max-w-2xl">
      <NetworkSecuritySettings {...args} />
    </div>
  ),
} satisfies Meta<typeof NetworkSecuritySettings>

export default meta
type Story = StoryObj<typeof meta>

export const CredentialsMode: Story = {}

export const SharedSecretMode: Story = { args: { network: secondaryNetwork } }
