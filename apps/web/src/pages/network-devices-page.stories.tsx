import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { NetworkDevicesPage } from "@/pages/network-devices-page"

const meta = {
  title: "Pages/NetworkDevices",
  component: NetworkDevicesPage,
  args: { networkId: "net-home-lab" },
  parameters: { layout: "fullscreen", location: "/networks/net-home-lab" },
  render: (args) => (
    <AppShell>
      <NetworkDevicesPage {...args} />
    </AppShell>
  ),
} satisfies Meta<typeof NetworkDevicesPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OfficeNetwork: Story = {
  args: { networkId: "net-office-mesh" },
  parameters: { location: "/networks/net-office-mesh" },
}
