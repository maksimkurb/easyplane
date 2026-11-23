import type { Meta, StoryObj } from "@storybook/react-vite"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const meta = {
  title: "UI/Dialog",
  component: DialogContent,
  args: { size: "md" },
  argTypes: { size: { control: "select", options: ["sm", "md", "lg", "xl"] } },
  parameters: { layout: "centered" },
  render: (args) => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Rotate the network secret?</DialogTitle>
          <DialogDescription>
            Every device must receive the new secret before it can reconnect.
            Anchors are updated first; members pick it up on their next config
            push.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
          All 9 devices will briefly disconnect while the secret is rotated.
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive">
            <Trash2Icon />
            Rotate secret
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
} satisfies Meta<typeof DialogContent>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Small: Story = { args: { size: "sm" } }

export const Large: Story = {
  args: { size: "lg" },
  render: (args) => (
    <Dialog defaultOpen>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Import a network from TOML</DialogTitle>
          <DialogDescription>
            Preview the diff before anything is written. Device credentials are
            never imported.
          </DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
          {`[network_identity]
network_name = "easytier-home-lab"
network_secret = "…"

[[peer]]
uri = "tcp://203.0.113.42:11010"`}
        </pre>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const LongScrollingBody: Story = {
  render: (args) => (
    <Dialog defaultOpen>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Compiled ACL for nas-01</DialogTitle>
          <DialogDescription>
            Read-only, generated from policy version 7.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {Array.from({ length: 18 }, (_, index) => (
            <p className="rounded-md bg-surface-2 px-3 py-2 font-mono text-xs" key={index}>
              allow tcp from 10.42.0.0/16 to 10.42.{index}.0/24
            </p>
          ))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
