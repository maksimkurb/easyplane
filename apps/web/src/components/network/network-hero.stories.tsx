import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { NetworkHero, type NetworkTab } from "@/components/network/network-hero"
import { primaryNetwork } from "../../../.storybook/fixtures/networks"

function HeroDemo({ tab }: { tab: NetworkTab }) {
  const [active] = useState<NetworkTab>(tab)
  return (
    <NetworkHero
      active={active}
      deviceCount={9}
      network={primaryNetwork}
      onAddDevice={() => undefined}
      online={7}
      total={9}
      waiting={2}
    />
  )
}

const meta = {
  title: "Network/NetworkHero",
  component: NetworkHero,
  args: { active: "devices" },
  render: (args) => <HeroDemo tab={args.active} />,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NetworkHero>

export default meta
type Story = StoryObj<typeof meta>

export const Devices: Story = {}

export const Map: Story = { args: { active: "map" } }

export const Access: Story = { args: { active: "access" } }

export const Settings: Story = { args: { active: "settings" } }

export const LoadingCounts: Story = {
  render: () => (
    <NetworkHero
      active="devices"
      deviceCount={0}
      devicesLoading
      network={primaryNetwork}
      onAddDevice={() => undefined}
      online={0}
      total={0}
      waiting={0}
    />
  ),
}
