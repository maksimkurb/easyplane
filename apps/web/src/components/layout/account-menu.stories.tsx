import type { Meta, StoryObj } from "@storybook/react-vite"

import { AccountMenu } from "@/components/layout/account-menu"

const meta = {
  title: "Layout/AccountMenu",
  component: AccountMenu,
  args: { variant: "avatar" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof AccountMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Avatar: Story = {}

export const SidebarVariant: Story = {
  args: { variant: "sidebar" },
  render: (args) => (
    <div className="w-64 rounded-lg bg-sidebar p-2 text-sidebar-foreground">
      <AccountMenu {...args} />
    </div>
  ),
}

export const SidebarCollapsed: Story = {
  args: { variant: "sidebar", collapsed: true },
  render: (args) => (
    <div className="w-[76px] rounded-lg bg-sidebar p-2 text-sidebar-foreground">
      <AccountMenu {...args} />
    </div>
  ),
}
