import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const items = [
  { value: "debian", label: "Debian GNU/Linux 12" },
  { value: "ubuntu", label: "Ubuntu 24.04 LTS" },
  { value: "fedora", label: "Fedora Server 41" },
  { value: "arch", label: "Arch Linux" },
]

const meta = {
  title: "UI/Select",
  component: SelectTrigger,
  args: { size: "default" },
  argTypes: { size: { control: "select", options: ["sm", "default"] } },
  render: (args) => (
    <div className="w-80 max-w-full">
      <Select defaultValue="debian" items={items}>
        <SelectTrigger {...args} aria-label="Operating system">
          <SelectValue placeholder="Choose an OS" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ),
} satisfies Meta<typeof SelectTrigger>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Small: Story = { args: { size: "sm" } }

export const Placeholder: Story = {
  render: (args) => (
    <div className="w-80 max-w-full">
      <Select items={items}>
        <SelectTrigger {...args} aria-label="Operating system">
          <SelectValue placeholder="Choose an OS" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ),
}

export const Open: Story = {
  render: (args) => (
    <div className="w-80 max-w-full">
      <Select defaultOpen defaultValue="debian" items={items}>
        <SelectTrigger {...args} aria-label="Operating system">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Linux distributions</SelectLabel>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem disabled value="bsd">
            FreeBSD (no agent yet)
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const LongOption: Story = {
  render: (args) => (
    <div className="w-80 max-w-full">
      <Select
        defaultValue="long"
        items={[
          {
            value: "long",
            label:
              "a-very-long-hostname-that-keeps-going-beyond-any-reasonable-select-width",
          },
        ]}
      >
        <SelectTrigger {...args} aria-label="Device">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="long">
            a-very-long-hostname-that-keeps-going-beyond-any-reasonable-select-width
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}
