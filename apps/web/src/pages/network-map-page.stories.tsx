import type { Meta, StoryObj } from "@storybook/react-vite"

import { AppShell } from "@/components/layout/app-shell"
import { NetworkMapPage } from "@/pages/network-map-page"

const meta = {
  title: "Pages/NetworkMap",
  component: NetworkMapPage,
  args: { networkId: "net-home-lab" },
  parameters: { layout: "fullscreen", location: "/networks/net-home-lab/map" },
  render: (args) => (
    <AppShell>
      <NetworkMapPage {...args} />
    </AppShell>
  ),
} satisfies Meta<typeof NetworkMapPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
