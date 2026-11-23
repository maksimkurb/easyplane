import type { Meta, StoryObj } from "@storybook/react-vite"

import { ThemeSelector } from "@/components/theme-selector"

const meta = {
  title: "Components/ThemeSelector",
  component: ThemeSelector,
  render: () => (
    <div className="w-64 rounded-xl bg-sidebar p-3 text-sidebar-foreground">
      <ThemeSelector />
    </div>
  ),
} satisfies Meta<typeof ThemeSelector>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
