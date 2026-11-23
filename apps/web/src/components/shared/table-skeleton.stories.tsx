import type { Meta, StoryObj } from "@storybook/react-vite"

import { TableSkeleton } from "@/components/shared/table-skeleton"

const meta = {
  title: "Shared/TableSkeleton",
  component: TableSkeleton,
  args: { rows: 3 },
  argTypes: { rows: { control: { type: "number", min: 0, max: 10 } } },
} satisfies Meta<typeof TableSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const ManyRows: Story = { args: { rows: 6 } }
