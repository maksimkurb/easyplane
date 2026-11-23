import type { Meta, StoryObj } from "@storybook/react-vite"

import { CopyInline } from "@/components/shared/copy-inline"

const meta = {
  title: "Shared/CopyInline",
  component: CopyInline,
  args: {
    value: "10.42.0.11",
    label: "Copy virtual IP",
  },
} satisfies Meta<typeof CopyInline>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const LongIdentifier: Story = {
  args: {
    value: "MCowBQYDK2VwAyEAGb0aXZzP0lY7eW8F1G6QxC9kR2sT4uV5wX6yZ7aB8cD9eF0",
    label: "Copy public key",
    className: "max-w-64",
  },
}

export const Multiline: Story = {
  args: {
    value:
      "tcp://192.168.1.30:11010, udp://192.168.1.30:11010, wg://192.168.1.30:11011",
    label: "Copy endpoints",
    multiline: true,
    className: "max-w-72 h-auto py-1.5",
  },
}
