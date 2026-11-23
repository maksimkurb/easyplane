import type { Meta, StoryObj } from "@storybook/react-vite"
import { PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"

import { IconButtonWithTooltip } from "@/components/shared/icon-button-with-tooltip"

const meta = {
  title: "Shared/IconButtonWithTooltip",
  component: IconButtonWithTooltip,
  args: { label: "Rename device", variant: "ghost", size: "icon-sm" },
  render: (args) => (
    <div className="flex items-center gap-2">
      <IconButtonWithTooltip {...args} />
      <IconButtonWithTooltip {...args} label="Push configuration">
        <RefreshCwIcon />
      </IconButtonWithTooltip>
      <IconButtonWithTooltip {...args} label="Remove device" variant="destructive">
        <Trash2Icon />
      </IconButtonWithTooltip>
    </div>
  ),
} satisfies Meta<typeof IconButtonWithTooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <IconButtonWithTooltip {...args}>
      <PencilIcon />
    </IconButtonWithTooltip>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, label: "Push configuration (offline)" },
  render: (args) => (
    <IconButtonWithTooltip {...args}>
      <RefreshCwIcon />
    </IconButtonWithTooltip>
  ),
}
