import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: { children: "Badge", variant: "default", size: "default" },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "success",
        "warning",
        "destructive",
        "outline",
        "ghost",
        "link",
      ],
    },
    size: { control: "select", options: ["default", "xs"] },
    children: { control: "text" },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {(
        [
          "default",
          "secondary",
          "success",
          "warning",
          "destructive",
          "outline",
          "ghost",
          "link",
        ] as const
      ).map((variant) => (
        <Badge {...args} key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
}

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge {...args} size="default">
        Default
      </Badge>
      <Badge {...args} size="xs">
        Extra small
      </Badge>
    </div>
  ),
}

export const LongText: Story = {
  args: {
    children:
      "Credential expires in 3 days and the device has not been seen since Monday",
    variant: "warning",
  },
  render: (args) => (
    <div className="max-w-56">
      <Badge {...args} className="h-auto max-w-full py-1 whitespace-normal" />
    </div>
  ),
}

export const WithIcon: Story = {
  args: {
    children: (
      <>
        Next
        <ArrowRightIcon data-icon="inline-end" />
      </>
    ),
    variant: "secondary",
  },
}
