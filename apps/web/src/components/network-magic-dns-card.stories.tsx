import type { Meta, StoryObj } from "@storybook/react-vite"

import { NetworkMagicDnsCard } from "@/components/network-magic-dns-card"

const meta = {
  title: "Components/NetworkMagicDnsCard",
  component: NetworkMagicDnsCard,
  args: { networkId: "net-home-lab", embedded: false },
  render: (args) => (
    <div className="max-w-2xl">
      <NetworkMagicDnsCard {...args} />
    </div>
  ),
} satisfies Meta<typeof NetworkMagicDnsCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Embedded: Story = { args: { embedded: true } }

export const Disabled: Story = { args: { networkId: "net-office-mesh" } }
