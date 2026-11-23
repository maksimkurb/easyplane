import type { Meta, StoryObj } from "@storybook/react-vite"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const meta = {
  title: "UI/Sheet",
  component: SheetContent,
  args: { side: "right" },
  argTypes: {
    side: { control: "select", options: ["top", "right", "bottom", "left"] },
  },
  parameters: { layout: "centered" },
  render: (args) => (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button variant="outline" />}>Open sheet</SheetTrigger>
      <SheetContent {...args}>
        <SheetHeader>
          <SheetTitle>Device details</SheetTitle>
          <SheetDescription>
            Raw fields reported by the client, without interpretation.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 text-[13px]">
          <p>
            <span className="text-fg-3">Hostname</span> · nas-01
          </p>
          <p>
            <span className="text-fg-3">Peer ID</span> · 1001
          </p>
          <p>
            <span className="text-fg-3">NAT</span> · PortRestricted
          </p>
        </div>
        <SheetFooter>
          <Button variant="outline">Copy JSON</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
} satisfies Meta<typeof SheetContent>

export default meta
type Story = StoryObj<typeof meta>

export const Right: Story = {}

export const Left: Story = { args: { side: "left" } }

export const Bottom: Story = {
  args: { side: "bottom" },
  render: (args) => (
    <Sheet defaultOpen>
      <SheetContent {...args}>
        <SheetHeader>
          <SheetTitle>Filter devices</SheetTitle>
          <SheetDescription>Phone-friendly filter sheet.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4 text-sm">All · Online · Issues · Pending</div>
      </SheetContent>
    </Sheet>
  ),
}

export const WideRight: Story = {
  args: { className: "sm:max-w-xl" },
}
