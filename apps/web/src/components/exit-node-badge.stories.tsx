import type { Meta, StoryObj } from "@storybook/react-vite"

import { ExitNodeBadge } from "@/components/exit-node-badge"

const meta = {
  title: "Components/ExitNodeBadge",
  component: ExitNodeBadge,
  args: { state: "approved" },
  argTypes: {
    state: { control: "inline-radio", options: ["none", "proposed", "approved"] },
  },
} satisfies Meta<typeof ExitNodeBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Approved: Story = {}

export const Proposed: Story = { args: { state: "proposed" } }

export const None: Story = {
  args: { state: "none" },
  render: (args) => (
    <p className="text-sm text-fg-3">
      Renders nothing for “none”: <ExitNodeBadge {...args} />
    </p>
  ),
}
