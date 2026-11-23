import type { Meta, StoryObj } from "@storybook/react-vite"

import { CompactTopologyMap } from "@/components/topology/compact-topology-map"
import { topologyLinks, topologyNodes } from "../../../.storybook/fixtures/network"

const meta = {
  title: "Topology/CompactTopologyMap",
  component: CompactTopologyMap,
  args: {
    nodes: topologyNodes,
    links: topologyLinks,
    selectedNodeId: null,
    onSelectNode: () => undefined,
    deviceOsById: {
      "dev-nas-01": { type: "linux", distribution: "Debian GNU/Linux" },
      "dev-edge-router": { type: "linux", distribution: "OpenWrt" },
      "dev-macbook-pro": { type: "macos", distribution: "macOS" },
      "dev-desktop-win": { type: "windows", distribution: "Windows 11 Pro" },
      "dev-rpi-sensor": { type: "linux", distribution: "Raspberry Pi OS" },
    },
  },
  render: (args) => (
    <div className="mx-auto w-full max-w-[440px]">
      <CompactTopologyMap {...args} />
    </div>
  ),
} satisfies Meta<typeof CompactTopologyMap>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Selected: Story = { args: { selectedNodeId: "topo-nas" } }

export const SmallNetwork: Story = {
  args: { nodes: topologyNodes.slice(0, 3), links: topologyLinks.slice(0, 1) },
}

export const Empty: Story = { args: { nodes: [], links: [] } }
