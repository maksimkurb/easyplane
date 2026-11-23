import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { NetworkAccessPage } from "@/pages/network-access-page"

const meta = {
  title: "Pages/NetworkAccess",
  component: NetworkAccessPage,
  args: { networkId: "net-home-lab" },
  parameters: { layout: "fullscreen", location: "/networks/net-home-lab/access" },
  render: (args) => (
    <AppShell>
      <NetworkAccessPage {...args} />
    </AppShell>
  ),
} satisfies Meta<typeof NetworkAccessPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OpenPolicy: Story = {
  args: { networkId: "net-office-mesh" },
  parameters: { location: "/networks/net-office-mesh/access" },
}
