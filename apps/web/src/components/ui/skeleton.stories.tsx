import type { Meta, StoryObj } from "@storybook/react-vite"

import { Skeleton } from "@/components/ui/skeleton"

const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  args: { className: "h-4 w-48" },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const DeviceRow: Story = {
  render: () => (
    <div className="flex w-full max-w-2xl items-center gap-3.5 rounded-xl bg-card p-4 ring-1 ring-line">
      <Skeleton className="size-9 rounded-[9px]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="size-9 rounded-lg" />
    </div>
  ),
}

export const Card: Story = {
  render: () => (
    <div className="w-full max-w-md space-y-3 rounded-xl bg-card p-5 ring-1 ring-line">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  ),
}
