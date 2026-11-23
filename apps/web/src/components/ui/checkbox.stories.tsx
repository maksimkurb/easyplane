import type { Meta, StoryObj } from "@storybook/react-vite"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

const meta = {
  title: "UI/Checkbox",
  component: Checkbox,
  args: { defaultChecked: false },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Checkbox aria-label="Stateful" id="checkbox-story" {...args} />
      <Label htmlFor="checkbox-story">Stateful rule</Label>
    </div>
  ),
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Checked: Story = { args: { defaultChecked: true } }

export const Indeterminate: Story = {
  args: { defaultChecked: "indeterminate" },
}

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Checkbox aria-label="Acknowledged" disabled={args.disabled} id="checkbox-disabled" />
      <Label htmlFor="checkbox-disabled">I understand the risk</Label>
    </div>
  ),
}

export const Group: Story = {
  render: () => (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Allow protocols</legend>
      {["tcp", "udp", "icmp"].map((protocol) => (
        <div className="flex items-center gap-2" key={protocol}>
          <Checkbox defaultChecked={protocol !== "icmp"} id={`protocol-${protocol}`} />
          <Label htmlFor={`protocol-${protocol}`}>{protocol.toUpperCase()}</Label>
        </div>
      ))}
    </fieldset>
  ),
}
