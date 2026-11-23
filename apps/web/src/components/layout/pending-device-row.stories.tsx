import type { Meta, StoryObj } from "@storybook/react-vite"

import { PendingDeviceRow } from "@/components/layout/pending-device-row"
import { deviceById } from "../../../.storybook/fixtures/devices"

const meta = {
  title: "Layout/PendingDeviceRow",
  component: PendingDeviceRow,
  args: {
    device: deviceById.get("dev-iphone-anna")!,
    networkName: "home-lab",
  },
  render: (args) => (
    <div className="max-w-3xl overflow-hidden rounded-xl bg-card ring-1 ring-line">
      <PendingDeviceRow {...args} />
    </div>
  ),
} satisfies Meta<typeof PendingDeviceRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const FedoraServer: Story = {
  args: { device: deviceById.get("dev-fedora-ci")!, networkName: "office-mesh" },
}

export const LongName: Story = {
  args: {
    device: {
      ...deviceById.get("dev-iphone-anna")!,
      hostname:
        "a-pending-device-with-a-hostname-long-enough-to-need-truncation-on-a-phone",
      dnsName: null,
    },
  },
}
