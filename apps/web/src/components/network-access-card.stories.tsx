import type { Meta, StoryObj } from "@storybook/react-vite"

import { NetworkAccessCard } from "@/components/network-access-card"
import { primaryNetwork, secondaryNetwork } from "../../.storybook/fixtures/networks"

const meta = {
  title: "Components/NetworkAccessCard",
  component: NetworkAccessCard,
  args: { network: primaryNetwork },
  render: (args) => (
    <div className="max-w-2xl">
      <NetworkAccessCard {...args} />
    </div>
  ),
} satisfies Meta<typeof NetworkAccessCard>

export default meta
type Story = StoryObj<typeof meta>

export const CredentialsMode: Story = {}

export const SharedSecretMode: Story = { args: { network: secondaryNetwork } }
