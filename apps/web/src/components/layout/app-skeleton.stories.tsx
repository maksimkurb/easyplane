import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppSkeleton } from "@/components/layout/app-skeleton"

const meta = {
  title: "Layout/AppSkeleton",
  component: AppSkeleton,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
