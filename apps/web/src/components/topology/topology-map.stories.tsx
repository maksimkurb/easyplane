import type { Meta, StoryObj } from "@storybook/react-vite"

import { TopologyMap } from "@/components/topology/topology-map"
import { topologyLinks, topologyNodes } from "../../../.storybook/fixtures/network"

const meta = {
  title: "Topology/TopologyMap",
  component: TopologyMap,
  args: {
    nodes: topologyNodes,
    links: topologyLinks,
    selectedNodeId: null,
    onSelectNode: () => undefined,
    onSelectLink: () => undefined,
    minimap: false,
    pingLabels: false,
    compact: false,
    slim: false,
    className: "h-[520px] rounded-xl bg-card ring-1 ring-line",
    exitNodeByDeviceId: { "dev-nas-01": "approved", "dev-rpi-sensor": "proposed" },
    deviceOsById: {
      "dev-nas-01": { type: "linux", distribution: "Debian GNU/Linux" },
      "dev-edge-router": { type: "linux", distribution: "OpenWrt" },
      "dev-macbook-pro": { type: "macos", distribution: "macOS" },
      "dev-desktop-win": { type: "windows", distribution: "Windows 11 Pro" },
      "dev-rpi-sensor": { type: "linux", distribution: "Raspberry Pi OS" },
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TopologyMap>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Slim: Story = { args: { slim: true } }

export const Compact: Story = { args: { compact: true } }

export const WithMinimap: Story = { args: { minimap: true } }

export const Selected: Story = { args: { selectedNodeId: "topo-nas" } }

export const Empty: Story = { args: { nodes: [], links: [] } }
