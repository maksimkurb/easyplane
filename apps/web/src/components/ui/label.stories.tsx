import type { Meta, StoryObj } from "@storybook/react-vite"

import { Label } from "@/components/ui/label"

const meta = {
  title: "UI/Label",
  component: Label,
  args: { children: "IPv4 CIDR" },
  render: (args) => (
    <div className="flex flex-col gap-1.5">
      <Label {...args} htmlFor="label-target" />
      <input
        className="h-10 rounded-lg border border-line-2 bg-card px-3 text-sm"
        defaultValue="10.42.0.0/16"
        id="label-target"
      />
    </div>
  ),
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const LongLabel: Story = {
  args: {
    children:
      "An unusually long field label that wraps instead of pushing the control",
  },
}
