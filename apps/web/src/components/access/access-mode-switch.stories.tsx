import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { AccessModeSwitch, ModeChangeDialog } from "@/components/access/access-mode-switch"
import type { AccessMode } from "@/lib/access-policy"

function SwitchDemo({ initial, disabled }: { initial: AccessMode; disabled?: boolean }) {
  const [value, setValue] = useState<AccessMode>(initial)
  return <AccessModeSwitch disabled={disabled} onChange={setValue} value={value} />
}

const meta = {
  title: "Access/AccessModeSwitch",
  component: AccessModeSwitch,
  args: { value: "rules" },
  render: (args) => <SwitchDemo disabled={args.disabled} initial={args.value} />,
} satisfies Meta<typeof AccessModeSwitch>

export default meta
type Story = StoryObj<typeof meta>

export const Rules: Story = { args: { value: "rules" } }

export const Open: Story = { args: { value: "open" } }

export const Json: Story = { args: { value: "json" } }

export const Disabled: Story = { args: { value: "rules", disabled: true } }

export const ConfirmOpen: Story = {
  render: () => (
    <ModeChangeDialog
      onConfirm={() => undefined}
      onOpenChange={() => undefined}
      open
      target="open"
    />
  ),
}

export const ConfirmRules: Story = {
  render: () => (
    <ModeChangeDialog
      onConfirm={() => undefined}
      onOpenChange={() => undefined}
      open
      target="rules"
    />
  ),
}
