import type { Meta, StoryObj } from "@storybook/react-vite"

import { NetworkRendezvousCard } from "@/components/network-rendezvous-card"
import { primaryNetwork, secondaryNetwork } from "../../.storybook/fixtures/networks"

const meta = {
  title: "Components/NetworkRendezvousCard",
  component: NetworkRendezvousCard,
  args: { network: primaryNetwork, embedded: false },
  render: (args) => (
    <div className="max-w-2xl">
      <NetworkRendezvousCard {...args} />
    </div>
  ),
} satisfies Meta<typeof NetworkRendezvousCard>

export default meta
type Story = StoryObj<typeof meta>

export const Configured: Story = {}

export const NotConfigured: Story = { args: { network: secondaryNetwork } }

export const Embedded: Story = { args: { embedded: true } }
