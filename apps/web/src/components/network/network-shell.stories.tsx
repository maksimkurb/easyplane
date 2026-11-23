import type { Meta, StoryObj } from "@storybook/react-vite"

import { NetworkShell } from "@/components/network/network-shell"

const meta = {
  title: "Network/NetworkShell",
  component: NetworkShell,
  args: { networkId: "net-home-lab", tab: "devices" },
  render: (args) => (
    <NetworkShell {...args}>
      {(data) => (
        <div className="space-y-2">
          <p className="text-sm text-fg-2">
            Loaded {data.devices.length} devices, {data.routes.length} routes and{" "}
            {data.invites.length} invites for {data.network.name}.
          </p>
          <p className="text-xs text-fg-3">
            {data.online} of {data.total} approved devices online · {data.waiting}{" "}
            waiting for a decision
          </p>
        </div>
      )}
    </NetworkShell>
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NetworkShell>

export default meta
type Story = StoryObj<typeof meta>

export const DevicesTab: Story = {}

export const SettingsTab: Story = { args: { tab: "settings" } }
