import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlusIcon } from "lucide-react"

import { LinkButton } from "@/components/shared/link-button"

const meta = {
  title: "Shared/LinkButton",
  component: LinkButton,
  args: {
    href: "/networks/net-home-lab",
    children: "Open network",
    variant: "default",
    size: "default",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline", "secondary", "ghost", "destructive", "link"],
    },
    size: {
      control: "select",
      options: ["xs", "sm", "default", "lg", "xl", "icon", "icon-xs", "icon-sm", "icon-lg"],
    },
  },
} satisfies Meta<typeof LinkButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithIcon: Story = {
  args: { children: <><PlusIcon />Add device</> },
}

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map(
        (variant) => (
          <LinkButton {...args} key={variant} variant={variant}>
            {variant}
          </LinkButton>
        )
      )}
    </div>
  ),
}
