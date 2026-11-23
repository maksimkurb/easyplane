import type { Meta, StoryObj } from "@storybook/react-vite"

import { NetworkPeersCard } from "@/components/network-peers-card"

const meta = {
  title: "Components/NetworkPeersCard",
  component: NetworkPeersCard,
  args: { networkId: "net-home-lab", embedded: false },
  render: (args) => (
    <div className="max-w-2xl">
      <NetworkPeersCard {...args} />
    </div>
  ),
} satisfies Meta<typeof NetworkPeersCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Embedded: Story = { args: { embedded: true } }

export const EmptyNetwork: Story = { args: { networkId: "net-office-mesh" } }
