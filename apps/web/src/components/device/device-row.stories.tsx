import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceRow } from "@/components/device/device-row"
import { deviceById, devices, homeDevices, routesByDevice } from "../../../.storybook/fixtures/devices"

const meta = {
  title: "Components/Device/DeviceRow",
  component: DeviceRow,
  args: {
    device: homeDevices[0]!,
    networkId: "net-home-lab",
    routes: routesByDevice("dev-nas-01"),
    networkName: "home-lab",
  },
  argTypes: {
    credentialsMode: { control: "boolean" },
    useRendezvous: { control: "boolean" },
    networkName: { control: "text" },
  },
  render: (args) => (
    <div className="w-full overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
      <DeviceRow {...args} />
    </div>
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DeviceRow>

export default meta
type Story = StoryObj<typeof meta>

export const OnlineHubAnchor: Story = {}

export const WithDescriptionAndTags: Story = {
  args: {
    device: deviceById.get("dev-macbook-pro")!,
    routes: [],
  },
}

export const Offline: Story = {
  args: { device: deviceById.get("dev-pixel-9")!, routes: [] },
}

export const Updating: Story = {
  args: { device: deviceById.get("dev-desktop-win")!, routes: [] },
}

export const PushFailed: Story = {
  args: { device: deviceById.get("dev-kubuntu-laptop")!, routes: [] },
}

export const Blocked: Story = {
  args: { device: deviceById.get("dev-nixos-nas")!, routes: [] },
}

export const LongNameAndDescription: Story = {
  args: { device: deviceById.get("dev-mac-studio-office")!, networkName: "office-mesh" },
}

export const UnknownOs: Story = {
  args: { device: deviceById.get("dev-kiosk")!, networkName: "office-mesh" },
}

/**
 * Every realistic row state in one list, for checking alignment across the
 * five-column desktop grid and the stacked phone layout.
 */
export const Gallery: Story = {
  render: () => (
    <div className="w-full divide-y divide-line overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
      {devices
        .filter((device) => device.state !== "pending")
        .map((device) => (
          <DeviceRow
            device={device}
            key={device.id}
            networkId={device.networkId}
            networkName={device.networkId === "net-home-lab" ? "home-lab" : "office-mesh"}
            routes={routesByDevice(device.id)}
          />
        ))}
    </div>
  ),
}

export const EveryOs: Story = {
  render: () => (
    <div className="w-full divide-y divide-line overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-line">
      {[
        "dev-nas-01",
        "dev-macbook-pro",
        "dev-desktop-win",
        "dev-pixel-9",
        "dev-iphone-anna",
        "dev-edge-router",
        "dev-rpi-sensor",
        "dev-kubuntu-laptop",
        "dev-arch-devbox",
        "dev-alpine-docker",
        "dev-nixos-nas",
        "dev-freebsd-fw",
        "dev-office-nas",
      ].map((id) => {
        const device = deviceById.get(id)
        if (!device) return null
        return (
          <DeviceRow
            device={device}
            key={device.id}
            networkId={device.networkId}
            networkName={device.networkId === "net-home-lab" ? "home-lab" : "office-mesh"}
          />
        )
      })}
    </div>
  ),
}
