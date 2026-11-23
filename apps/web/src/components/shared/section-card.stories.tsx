import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/shared/section-card"

const meta = {
  title: "Shared/SectionCard",
  component: SectionCard,
  args: {
    title: "Access",
    description: "Who may reach this network and how.",
    children: (
      <p className="text-[13px] text-fg-2">
        Credentials mode: two anchors, eight members, one expiring credential.
      </p>
    ),
  },
  render: (args) => (
    <div className="max-w-md">
      <SectionCard {...args} />
    </div>
  ),
} satisfies Meta<typeof SectionCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithAction: Story = {
  args: {
    action: (
      <Button size="sm" variant="outline">
        Switch mode
      </Button>
    ),
  },
}

export const LongText: Story = {
  args: {
    title: "Rendezvous and relayed connectivity",
    description:
      "When two devices cannot punch through their NATs, a public relay carries the traffic instead. This costs bandwidth on the relay and is disabled for the office network.",
    children: (
      <p className="text-[13px] text-fg-2">
        The explanation is intentionally long to verify the card header wraps
        without pushing the action button off-screen.
      </p>
    ),
    action: (
      <Button size="sm" variant="outline">
        Configure
      </Button>
    ),
  },
}
