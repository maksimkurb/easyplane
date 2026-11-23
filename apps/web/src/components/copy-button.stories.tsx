import type { Meta, StoryObj } from "@storybook/react-vite"

import { CopyButton } from "@/components/copy-button"

const meta = {
  title: "Components/CopyButton",
  component: CopyButton,
  args: { value: "MCowBQYDK2VwAyEAGb0aXZzP0lY7eW8F1G6QxC9kR2sT4uV5wX6yZ7aB8cD9eF0" },
} satisfies Meta<typeof CopyButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const CustomLabel: Story = { args: { label: "Copy secret" } }

export const LongValue: Story = {
  args: {
    value:
      "tcp://192.168.1.30:11010,udp://192.168.1.30:11010,wg://192.168.1.30:11011,quic://203.0.113.42:11012",
  },
}
