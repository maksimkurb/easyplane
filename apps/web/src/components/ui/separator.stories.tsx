import type { Meta, StoryObj } from "@storybook/react-vite"

import { Separator } from "@/components/ui/separator"

const meta = {
  title: "UI/Separator",
  component: Separator,
  render: (args) => (
    <div className="w-80 space-y-3 text-sm">
      <p>Above</p>
      <Separator {...args} />
      <p>Below</p>
    </div>
  ),
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {}

export const Vertical: Story = {
  render: (args) => (
    <div className="flex h-12 items-center gap-3 text-sm">
      <span>9 devices</span>
      <Separator {...args} orientation="vertical" />
      <span>7 online</span>
    </div>
  ),
}
