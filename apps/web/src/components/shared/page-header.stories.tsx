import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"

const meta = {
  title: "Shared/PageHeader",
  component: PageHeader,
  args: {
    title: "Devices",
    description:
      "Every device across every network, with the one status that matters.",
  },
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithActions: Story = {
  args: {
    actions: (
      <div className="flex gap-2">
        <Button size="sm" variant="outline">
          Import
        </Button>
        <Button size="sm">Add device</Button>
      </div>
    ),
  },
}

export const LongTitle: Story = {
  args: {
    title:
      "Pending approvals in networks that have more than one anchor and an expiring credential",
    description:
      "The description also wraps underneath the title at every breakpoint instead of disappearing on phones.",
  },
}
