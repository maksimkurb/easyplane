import type { Meta, StoryObj } from "@storybook/react-vite"
import { Route } from "wouter"

import { AppShell } from "@/components/layout/app-shell"
import { DeviceDetailPage } from "@/pages/device-detail-page"

const meta = {
  title: "Pages/DeviceDetail",
  component: DeviceDetailPage,
  parameters: { layout: "fullscreen", location: "/devices/dev-nas-01" },
  render: () => (
    <AppShell>
      <Route component={DeviceDetailPage} path="/devices/:id" />
    </AppShell>
  ),
} satisfies Meta<typeof DeviceDetailPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OfflineDevice: Story = {
  parameters: { location: "/devices/dev-pixel-9" },
}

export const PushFailedDevice: Story = {
  parameters: { location: "/devices/dev-kubuntu-laptop" },
}
