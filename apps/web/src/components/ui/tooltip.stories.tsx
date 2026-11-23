import type { Meta, StoryObj } from "@storybook/react-vite"
import { InfoIcon, RadioTowerIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const meta = {
  title: "UI/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="outline" />}>
        Hover me
      </TooltipTrigger>
      <TooltipContent>Tooltips explain a control in one line.</TooltipContent>
    </Tooltip>
  ),
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sides: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Tooltip defaultOpen key={side}>
          <TooltipTrigger render={<Button size="sm" variant="outline" />}>
            {side}
          </TooltipTrigger>
          <TooltipContent side={side}>Placed on the {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger
        render={
          <Button aria-label="Relay capable" size="icon-sm" variant="ghost" />
        }
      >
        <RadioTowerIcon />
      </TooltipTrigger>
      <TooltipContent>
        This node can relay traffic for peers behind symmetric NAT.
      </TooltipContent>
    </Tooltip>
  ),
}

export const LongContent: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger
        render={<Button aria-label="Details" size="icon-sm" variant="ghost" />}
      >
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Offline means the panel has not heard from the client recently. Queued
        configuration is kept and pushed on reconnect; nothing is lost.
      </TooltipContent>
    </Tooltip>
  ),
}
