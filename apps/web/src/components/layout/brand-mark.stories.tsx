import type { Meta, StoryObj } from "@storybook/react-vite"

import { BrandMark } from "@/components/layout/brand-mark"

const meta = {
  title: "Layout/BrandMark",
  component: BrandMark,
  parameters: { layout: "centered" },
} satisfies Meta<typeof BrandMark>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Large: Story = { args: { className: "block size-16" } }
