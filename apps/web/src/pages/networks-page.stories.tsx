import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { NetworksPage } from "@/pages/networks-page"

const meta = {
  title: "Pages/Networks",
  component: NetworksPage,
  parameters: { layout: "fullscreen", location: "/networks" },
  render: () => (
    <AppShell>
      <NetworksPage />
    </AppShell>
  ),
} satisfies Meta<typeof NetworksPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
