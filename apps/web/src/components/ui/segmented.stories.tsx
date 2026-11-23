import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Segmented } from "@/components/ui/segmented"

const options = [
  { value: "all", label: "All", count: 18 },
  { value: "online", label: "Online", count: 12 },
  { value: "issues", label: "Issues", count: 3 },
  { value: "pending", label: "Pending", count: 2 },
]

function SegmentedDemo(args: {
  size?: "default" | "sm"
  initial?: string
}) {
  const [value, setValue] = useState(args.initial ?? "all")
  return (
    <Segmented
      label="Device filter"
      onValueChange={setValue}
      options={options}
      size={args.size}
      value={value}
    />
  )
}

const meta = {
  title: "UI/Segmented",
  component: Segmented,
  args: { size: "default" },
  argTypes: { size: { control: "select", options: ["default", "sm"] } },
  render: (args) => (
    <SegmentedDemo initial={args.value} size={args.size} />
  ),
} satisfies Meta<typeof Segmented>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { value: "all" } }

export const Small: Story = { args: { size: "sm", value: "online" } }

export const Disabled: Story = {
  args: { value: "issues" },
  render: () => (
    <Segmented
      disabled
      label="Device filter"
      onValueChange={() => undefined}
      options={options}
      value="issues"
    />
  ),
}

export const PhoneWidth: Story = {
  render: () => (
    <div className="w-[390px] max-w-full overflow-x-auto">
      <SegmentedDemo initial="pending" size="default" />
    </div>
  ),
}
