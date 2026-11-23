import type { Meta, StoryObj } from "@storybook/react-vite"

import { NetworkRoutesCard } from "@/components/network-routes-card"

const meta = {
  title: "Components/NetworkRoutesCard",
  component: NetworkRoutesCard,
  args: { networkId: "net-home-lab", embedded: false },
  render: (args) => (
    <div className="max-w-3xl">
      <NetworkRoutesCard {...args} />
    </div>
  ),
} satisfies Meta<typeof NetworkRoutesCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Embedded: Story = { args: { embedded: true } }

export const EmptyNetwork: Story = { args: { networkId: "net-office-mesh" } }
