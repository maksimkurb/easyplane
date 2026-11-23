import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { DevicesPage } from "@/pages/devices-page"

const meta = {
  title: "Pages/Devices",
  component: DevicesPage,
  parameters: { layout: "fullscreen", location: "/devices" },
  render: () => (
    <AppShell>
      <DevicesPage />
    </AppShell>
  ),
} satisfies Meta<typeof DevicesPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const PendingApprovals: Story = {
  parameters: { location: "/pending" },
  render: () => (
    <AppShell>
      <DevicesPage pendingOnly />
    </AppShell>
  ),
}
