import type { Meta, StoryObj } from "@storybook/react-vite"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

const meta = {
  title: "UI/RadioGroup",
  component: RadioGroup,
  args: { defaultValue: "member" },
  render: (args) => (
    <RadioGroup {...args} aria-label="Device role" className="gap-3">
      {[
        { value: "member", label: "Member", hint: "Connects through an anchor" },
        { value: "anchor", label: "Anchor", hint: "Accepts connections from members" },
      ].map((option) => (
        <div className="flex items-start gap-2.5" key={option.value}>
          <RadioGroupItem aria-label={option.label} id={`role-${option.value}`} value={option.value} />
          <div className="grid gap-0.5">
            <Label htmlFor={`role-${option.value}`}>{option.label}</Label>
            <p className="text-xs text-fg-3">{option.hint}</p>
          </div>
        </div>
      ))}
    </RadioGroup>
  ),
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Disabled: Story = {
  render: (args) => (
    <RadioGroup {...args} aria-label="Device role" className="gap-3">
      <div className="flex items-center gap-2.5">
        <RadioGroupItem disabled id="disabled-member" value="member" />
        <Label htmlFor="disabled-member">Member</Label>
      </div>
      <div className="flex items-center gap-2.5">
        <RadioGroupItem disabled id="disabled-anchor" value="anchor" />
        <Label htmlFor="disabled-anchor">Anchor</Label>
      </div>
    </RadioGroup>
  ),
}
