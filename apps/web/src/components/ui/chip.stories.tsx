import type { Meta, StoryObj } from "@storybook/react-vite"

import { Chip, Dot } from "@/components/ui/chip"

const meta = {
  title: "UI/Chip",
  component: Chip,
  args: { children: "Chip", variant: "neutral" },
  argTypes: {
    variant: {
      control: "select",
      options: ["neutral", "brand", "relay", "ok", "warn", "err", "outline", "tag"],
    },
    children: { control: "text" },
  },
} satisfies Meta<typeof Chip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {(
        ["neutral", "brand", "relay", "ok", "warn", "err", "outline", "tag"] as const
      ).map((variant) => (
        <Chip {...args} key={variant} variant={variant}>
          {variant}
        </Chip>
      ))}
    </div>
  ),
}

export const Dots: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-sm">
      <span className="inline-flex items-center gap-1.5">
        <Dot online /> online
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot online={false} /> offline
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot /> undecided
      </span>
    </div>
  ),
}

export const LongCidrs: Story = {
  render: () => (
    <div className="flex max-w-72 flex-wrap gap-1.5">
      {[
        "10.42.0.0/16",
        "192.168.50.0/24",
        "2001:db8:3333:4444::/64",
        "172.20.0.0/16",
        "100.64.0.0/10",
      ].map((cidr) => (
        <Chip className="font-mono text-xs" key={cidr} variant="tag">
          {cidr}
        </Chip>
      ))}
    </div>
  ),
}
