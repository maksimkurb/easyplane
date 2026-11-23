import type { Meta, StoryObj } from "@storybook/react-vite"

import { DeviceDrawer } from "@/components/topology/device-drawer"
import {
  topologyLinks,
  topologyNodes,
  topology,
} from "../../../.storybook/fixtures/network"

const meta = {
  title: "Topology/DeviceDrawer",
  component: DeviceDrawer,
  args: {
    node: topologyNodes[0]!,
    observation: topology.observations[0]!,
    links: topologyLinks,
    nodes: topologyNodes,
    open: true,
    onOpenChange: () => undefined,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DeviceDrawer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const RelayCapable: Story = {
  args: { node: topologyNodes[1]!, observation: topology.observations[1]! },
}

export const Unmanaged: Story = {
  args: {
    node: topologyNodes[5]!,
    observation: null,
    links: [],
  },
}

export const Closed: Story = { args: { open: false } }
