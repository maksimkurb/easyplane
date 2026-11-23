import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { NetworkSettingsPage } from "@/pages/network-settings-page"

const meta = {
  title: "Pages/NetworkSettings",
  component: NetworkSettingsPage,
  args: { networkId: "net-home-lab" },
  parameters: { layout: "fullscreen", location: "/networks/net-home-lab/settings" },
  render: (args) => (
    <AppShell>
      <NetworkSettingsPage {...args} />
    </AppShell>
  ),
} satisfies Meta<typeof NetworkSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OfficeNetwork: Story = {
  args: { networkId: "net-office-mesh" },
  parameters: { location: "/networks/net-office-mesh/settings" },
}
