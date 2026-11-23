import type { Meta, StoryObj } from "@storybook/react-vite"

import { LanguageSelector } from "@/components/language-selector"

const meta = {
  title: "Components/LanguageSelector",
  component: LanguageSelector,
  render: () => (
    <div className="w-64 rounded-xl bg-sidebar p-3 text-sidebar-foreground">
      <LanguageSelector />
    </div>
  ),
} satisfies Meta<typeof LanguageSelector>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
