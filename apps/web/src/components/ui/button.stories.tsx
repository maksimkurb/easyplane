import type { Meta, StoryObj } from "@storybook/react-vite"
import { LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The single button primitive (Base UI + CVA). Every variant and size in one
 * place so a spacing or focus-ring change can be reviewed without a backend.
 */
const meta = {
  title: "UI/Button",
  component: Button,
  args: {
    children: "Save changes",
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
    disabled: { control: "boolean" },
    children: { control: "text" },
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map(
        (variant) => (
          <Button {...args} key={variant} variant={variant}>
            {variant}
          </Button>
        )
      )}
    </div>
  ),
}

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {(["xs", "sm", "default", "lg", "xl"] as const).map((size) => (
        <Button {...args} key={size} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
}

export const WithIcons: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args}>
        <PlusIcon />
        Add device
      </Button>
      <Button {...args} variant="outline">
        <LoaderCircleIcon className="animate-spin" />
        Pushing…
      </Button>
      <Button {...args} variant="destructive">
        <Trash2Icon />
        Remove
      </Button>
    </div>
  ),
}

export const IconOnly: Story = {
  args: { "aria-label": "Add device", children: <PlusIcon />, size: "icon" },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="icon-xs" />
      <Button {...args} size="icon-sm" />
      <Button {...args} size="icon" />
      <Button {...args} size="icon-lg" />
    </div>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, children: "Cannot save" },
}

/** Keyboard focus: the play function focuses the button to show the ring. */
export const Focused: Story = {
  args: { children: "Focused" },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector("button")?.focus()
  },
}

export const LongLabel: Story = {
  args: {
    children:
      "Regenerate every device credential in this network and push the new configuration",
    className: "max-w-72 whitespace-normal text-center",
  },
  parameters: { layout: "centered" },
}
