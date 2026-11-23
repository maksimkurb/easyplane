import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceAccessCard } from "@/components/device-access-card"
import { detailDevice } from "../../.storybook/fixtures/devices"

const meta = {
  title: "Components/DeviceAccessCard",
  component: DeviceAccessCard,
  args: { device: detailDevice },
  render: (args) => (
    <div className="max-w-2xl">
      <DeviceAccessCard {...args} />
    </div>
  ),
} satisfies Meta<typeof DeviceAccessCard>

export default meta
type Story = StoryObj<typeof meta>

export const Credentialed: Story = {}

export const SharedSecretDevice: Story = {
  args: {
    device: {
      ...detailDevice,
      accessMode: "shared_secret",
      credential: null,
      role: "member",
      effectiveRole: "member",
    },
  },
}

export const RevokedCredential: Story = {
  args: {
    device: {
      ...detailDevice,
      credential: detailDevice.credential
        ? { ...detailDevice.credential, status: "revoked", revokedAt: new Date().toISOString() }
        : null,
    },
  },
}
