import type { Meta, StoryObj } from "@storybook/react-vite"

import { Sidebar } from "@/components/layout/sidebar"

const meta = {
  title: "Layout/Sidebar",
  component: Sidebar,
  parameters: {
    layout: "fullscreen",
    location: "/networks/net-home-lab",
  },
  render: () => (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 bg-background p-6 text-sm text-fg-3">
        Desktop navigation. Collapse it with the chevron; the choice persists in
        localStorage.
      </div>
    </div>
  ),
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
