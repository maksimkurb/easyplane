import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import { ListPlaceholder } from "@/components/shared/list-placeholder"

const meta = {
  title: "Shared/ListPlaceholder",
  component: ListPlaceholder,
  args: {
    title: "No routes yet",
    description:
      "A device can advertise a subnet or become an exit node; approved routes appear here.",
    variant: "empty",
  },
  argTypes: { variant: { control: "select", options: ["empty", "error"] } },
} satisfies Meta<typeof ListPlaceholder>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithAction: Story = {
  args: {
    action: (
      <Button size="sm" variant="outline">
        Request a route
      </Button>
    ),
  },
}

export const Error: Story = {
  args: {
    variant: "error",
    title: "Couldn't load routes",
    description: "The request failed. The rest of the page still works.",
  },
}

export const LongText: Story = {
  args: {
    title: "No devices match these filters",
    description:
      "Try clearing the search box, choosing a different network, or switching from “issues” back to “all”. A device that has never connected will not appear until it presents a valid invite.",
  },
}
