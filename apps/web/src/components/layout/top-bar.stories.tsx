import type { Meta, StoryObj } from "@storybook/react-vite"

import { TopBar } from "@/components/layout/top-bar"

const meta = {
  title: "Layout/TopBar",
  component: TopBar,
  parameters: {
    layout: "fullscreen",
    // The bar is `lg:hidden`; view it with the Phone 390 or Tablet 768 preset.
    location: "/devices/dev-nas-01",
  },
} satisfies Meta<typeof TopBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Home: Story = { parameters: { location: "/networks" } }
