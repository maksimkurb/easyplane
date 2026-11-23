import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { OptionSelect, SelectEmptyHint } from "@/components/shared/option-select"

const options = [
  { value: "dev-nas-01", label: "nas-01" },
  { value: "dev-edge-router", label: "edge-router" },
  { value: "dev-rpi-sensor", label: "rpi-sensor" },
]

function OptionSelectDemo({ empty, disabled }: { empty?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState("")
  return (
    <div className="w-80 max-w-full">
      <OptionSelect
        aria-label="Anchor device"
        disabled={disabled}
        empty={
          empty ? (
            <SelectEmptyHint>
              No online anchors. Bring one online, or create a new invite with the
              anchor role.
            </SelectEmptyHint>
          ) : undefined
        }
        onValueChange={setValue}
        options={empty ? [] : options}
        placeholder="Choose an anchor"
        value={value}
      />
    </div>
  )
}

const meta = {
  title: "Shared/OptionSelect",
  component: OptionSelect,
  parameters: { layout: "centered" },
} satisfies Meta<typeof OptionSelect>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <OptionSelectDemo /> }

export const Empty: Story = { render: () => <OptionSelectDemo empty /> }

export const Disabled: Story = { render: () => <OptionSelectDemo disabled /> }

export const LongOption: Story = {
  render: () => (
    <div className="w-80 max-w-full">
      <OptionSelect
        aria-label="Device"
        onValueChange={() => undefined}
        options={[
          {
            value: "long",
            label:
              "a-very-long-hostname-that-keeps-going-beyond-any-reasonable-select-width",
          },
        ]}
        value="long"
      />
    </div>
  ),
}
