import type { Meta, StoryObj } from "@storybook/react-vite"

import { RelativeTime } from "@/components/shared/relative-time"

const now = Date.now()

const meta = {
  title: "Shared/RelativeTime",
  component: RelativeTime,
  args: { value: new Date(now - 12 * 60_000).toISOString() },
} satisfies Meta<typeof RelativeTime>

export default meta
type Story = StoryObj<typeof meta>

export const MinutesAgo: Story = {}

export const DaysAgo: Story = {
  args: { value: new Date(now - 3 * 86_400_000).toISOString() },
}

export const Empty: Story = { args: { value: null } }

export const CustomEmpty: Story = { args: { value: null, empty: "never" } }
