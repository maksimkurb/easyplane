import type { Meta, StoryObj } from "@storybook/react-vite"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const meta = {
  title: "UI/Input",
  component: Input,
  args: { placeholder: "Search devices…", type: "text" },
  argTypes: { disabled: { control: "boolean" } },
  render: (args) => (
    <div className="grid w-80 max-w-full gap-1.5">
      <Label htmlFor="input-story">Search</Label>
      <Input id="input-story" {...args} />
    </div>
  ),
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Filled: Story = {
  args: { defaultValue: "macbook-pro" },
}

export const Disabled: Story = { args: { disabled: true, defaultValue: "read-only" } }

export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "not-a-cidr" },
}

export const Search: Story = {
  args: { type: "search", defaultValue: "nas" },
  render: (args) => (
    <div className="w-80 max-w-full">
      <Input {...args} aria-label="Search devices" className="pl-9" />
    </div>
  ),
}

export const TextareaStory: Story = {
  name: "Textarea",
  render: () => (
    <div className="grid w-96 max-w-full gap-1.5">
      <Label htmlFor="textarea-story">Description</Label>
      <Textarea
        defaultValue="RAID storage and nightly Time Machine backups for the whole flat."
        id="textarea-story"
        rows={4}
      />
    </div>
  ),
}

export const TextareaInvalid: Story = {
  name: "Textarea invalid",
  render: () => (
    <div className="grid w-96 max-w-full gap-1.5">
      <Label htmlFor="textarea-invalid">Description</Label>
      <Textarea aria-invalid defaultValue="x" id="textarea-invalid" rows={2} />
      <p className="text-xs text-err">Description must be at least 3 characters.</p>
    </div>
  ),
}
