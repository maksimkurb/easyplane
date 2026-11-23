import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const meta = {
  title: "UI/Switch",
  component: Switch,
  args: { size: "default", defaultChecked: true },
  argTypes: { size: { control: "select", options: ["sm", "default"] } },
  render: (args) => (
    <div className="flex items-center gap-2.5">
      <Switch aria-label="MagicDNS" id="switch-story" {...args} />
      <Label htmlFor="switch-story">MagicDNS</Label>
    </div>
  ),
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Small: Story = { args: { size: "sm" } }

export const Unchecked: Story = { args: { defaultChecked: false } }

export const Disabled: Story = {
  args: { disabled: true, defaultChecked: false },
  render: (args) => (
    <div className="flex items-center gap-2.5">
      <Switch aria-label="Relay data" disabled={args.disabled} id="switch-disabled" />
      <Label htmlFor="switch-disabled">Relay data (admin only)</Label>
    </div>
  ),
}

function InteractiveSwitch() {
  const [checked, setChecked] = useState(true)
  return (
    <div className="flex items-center gap-2.5">
      <Switch
        aria-label="Hub"
        checked={checked}
        id="switch-interactive"
        onCheckedChange={setChecked}
      />
      <Label htmlFor="switch-interactive">
        Hub mode ({checked ? "on" : "off"})
      </Label>
    </div>
  )
}

export const Interactive: Story = { render: () => <InteractiveSwitch /> }
