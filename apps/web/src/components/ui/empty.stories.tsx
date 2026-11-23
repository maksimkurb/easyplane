import type { Meta, StoryObj } from "@storybook/react-vite"
import { InboxIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

const meta = {
  title: "UI/Empty",
  component: Empty,
  render: (args) => (
    <Empty {...args}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No devices yet</EmptyTitle>
        <EmptyDescription>
          Add a device with an invite, then approve it from this page.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm">
          <PlusIcon />
          Add device
        </Button>
      </EmptyContent>
    </Empty>
  ),
} satisfies Meta<typeof Empty>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const IconVariant: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No activity matches these filters</EmptyTitle>
        <EmptyDescription>
          Clear the filters or widen the date range.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
}

export const LongDescription: Story = {
  render: (args) => (
    <Empty {...args} className="max-w-md">
      <EmptyHeader>
        <EmptyTitle>Nothing waiting for approval</EmptyTitle>
        <EmptyDescription>
          Every device that ever asked to join has an answer. New devices appear
          here as soon as they present a valid invite and dial the rendezvous
          service, which can take up to a minute on slow mobile networks.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
}
