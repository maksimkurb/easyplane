import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

import "@/i18n"
import type {
  GetNetworkTopology200LinksItem as TopologyLink,
  GetNetworkTopology200NodesItem as TopologyNode,
  GetNetworkTopology200ObservationsItem as TopologyObservation,
} from "@/api/generated/model"

/**
 * React Flow measures the DOM and needs a real layout engine, so the component
 * test replaces it with a stub that exposes the props it was given. The custom
 * node is tested directly.
 */
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    edges,
    onNodeClick,
  }: {
    nodes: Array<{ id: string; data: { node: TopologyNode } }>
    edges: Array<{
      id: string
      label?: string
      style?: { strokeDasharray?: string }
    }>
    onNodeClick?: (event: unknown, node: { id: string }) => void
  }) => (
    <div data-testid="flow">
      <ul data-testid="flow-nodes">
        {nodes.map((node) => (
          <li
            data-node-id={node.id}
            key={node.id}
            onClick={() => onNodeClick?.({}, { id: node.id })}
          >
            {node.data.node.hostname}
          </li>
        ))}
      </ul>
      <ul data-testid="flow-edges">
        {edges.map((edge) => (
          <li
            data-dash={edge.style?.strokeDasharray ?? "solid"}
            data-edge-id={edge.id}
            key={edge.id}
          >
            {edge.label}
          </li>
        ))}
      </ul>
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  MarkerType: { ArrowClosed: "arrow" },
}))

vi.mock("@/api/generated/easyplane", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/api/generated/easyplane")>()
  return {
    ...actual,
    useGetDevice: () => ({
      data: {
        data: {
          id: "dev-b",
          state: "approved",
          online: "online",
          sync: "in-sync",
          machineId: "bbbbbbbb-2222-4222-8222-222222222222",
          hostname: "core-b",
          dnsName: "core-b",
          easytierVersion: "2.6.4-81487c36",
          os: { type: "linux", version: "6.8", distribution: "debian" },
          lastSeenAt: "2026-01-01T00:00:00.000Z",
          desiredRevision: 2,
          appliedRevision: 2,
          lastPushError: null,
        },
      },
      isLoading: false,
    }),
  }
})

import {
  TopologyMap,
  TopologyNodeCard,
} from "@/components/topology/topology-map"

function node(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    id: "ip:10.0.0.2",
    deviceId: "dev-a",
    hostname: "core-a",
    virtualIpv4: "10.0.0.2",
    networkLength: 24,
    version: "2.6.4-81487c36",
    managed: true,
    online: true,
    peerId: 1001,
    natType: "PortRestricted",
    tcpNatType: "Symmetric",
    natFriendly: false,
    publicIps: [],
    listeners: [],
    proxyCidrs: [],
    featureFlags: {
      isPublicServer: false,
      avoidRelayData: false,
      disableP2p: false,
      quicInput: true,
      kcpInput: true,
    },
    reachable: false,
    relayCapable: false,
    capabilityReasons: [],
    relaysFor: [],
    observed: true,
    ...overrides,
  }
}

function link(overrides: Partial<TopologyLink> = {}): TopologyLink {
  return {
    id: "ip:10.0.0.2--ip:10.0.0.3",
    source: "ip:10.0.0.2",
    target: "ip:10.0.0.3",
    kind: "direct",
    via: null,
    viaHostname: null,
    protocol: "tcp",
    rawTunnelType: "tcp",
    latencyMs: 1.2,
    lossPercent: 0,
    cost: 1,
    pathLatencyMs: 1,
    direction: "dialer",
    localAddr: "tcp://172.28.0.2:1234",
    remoteAddr: "tcp://172.28.0.3:11022",
    protocolIsFirstHop: false,
    asymmetric: false,
    observedBy: ["dev-a"],
    evidence: [],
    ...overrides,
  }
}

describe("topology map", () => {
  it("renders every node and styles direct/relayed edges differently", () => {
    const nodes = [
      node(),
      node({
        id: "ip:10.0.0.3",
        deviceId: "dev-b",
        hostname: "core-b",
        virtualIpv4: "10.0.0.3",
      }),
      node({
        id: "ip:10.0.0.4",
        deviceId: "dev-c",
        hostname: "core-c",
        virtualIpv4: "10.0.0.4",
      }),
    ]
    const links = [
      link(),
      link({
        id: "ip:10.0.0.3--ip:10.0.0.4",
        source: "ip:10.0.0.3",
        target: "ip:10.0.0.4",
        kind: "relayed",
        via: "ip:10.0.0.2",
        viaHostname: "core-a",
        cost: 2,
        protocolIsFirstHop: true,
      }),
    ]
    render(
      <TopologyMap
        links={links}
        nodes={nodes}
        onSelectNode={() => undefined}
        selectedNodeId={null}
      />
    )
    const renderedNodes = screen.getByTestId("flow-nodes")
    expect(within(renderedNodes).getAllByRole("listitem")).toHaveLength(3)
    expect(renderedNodes).toHaveTextContent("core-a")

    const edges = within(screen.getByTestId("flow-edges")).getAllByRole(
      "listitem"
    )
    expect(edges).toHaveLength(2)
    const direct = edges.find(
      (edge) => edge.getAttribute("data-edge-id") === links[0]!.id
    )!
    const relayed = edges.find(
      (edge) => edge.getAttribute("data-edge-id") === links[1]!.id
    )!
    expect(direct.getAttribute("data-dash")).toBe("solid")
    expect(direct).toHaveTextContent("tcp · 1.2 ms")
    expect(relayed.getAttribute("data-dash")).not.toBe("solid")
    expect(relayed).toHaveTextContent("core-a · 2 hops · tcp")
  })

  it("marks a relay-capable node with a tooltip and a relay badge", () => {
    const relayNode = node({
      relayCapable: true,
      relaysFor: ["ip:10.0.0.3", "ip:10.0.0.4"],
      listeners: ["tcp://0.0.0.0:11021"],
      publicIps: ["203.0.113.10"],
    })
    const { container } = render(
      <TopologyNodeCard node={relayNode} selected={false} />
    )
    expect(screen.getByLabelText("Relay-capable")).toBeInTheDocument()
    expect(screen.getByText("relays 2")).toBeInTheDocument()
    const card = container.firstElementChild as HTMLElement
    expect(card.getAttribute("title")).toContain("NAT PortRestricted")
    expect(card.getAttribute("title")).toContain("203.0.113.10")
  })

  it("mutes offline nodes", () => {
    const offline = node({ online: false, hostname: "core-off" })
    const { container } = render(
      <TopologyNodeCard node={offline} selected={false} />
    )
    expect(container.firstElementChild?.className).toContain("border-dashed")
  })

  it("highlights the node the page selected and uses the device glyph", () => {
    const { container } = render(
      <TopologyNodeCard
        highlighted
        node={node()}
        os={{ distribution: "Debian", type: "linux" }}
        selected={false}
        slim
      />
    )
    expect(container.firstElementChild?.className).toContain("ring-brand")
    expect(container.querySelector(".lucide-server")).not.toBeNull()
  })

  it("reports the clicked node so the page can open the drawer", () => {
    const nodes = [node(), node({ id: "ip:10.0.0.3", hostname: "core-b" })]
    const onSelectNode = vi.fn()
    render(
      <TopologyMap
        links={[link()]}
        nodes={nodes}
        onSelectNode={onSelectNode}
        selectedNodeId={null}
      />
    )
    fireEvent.click(screen.getByText("core-a"))
    expect(onSelectNode).toHaveBeenCalledWith("ip:10.0.0.2")
  })
})

describe("device drawer", () => {
  it("shows the status fields and the raw client data", async () => {
    const { DeviceDrawer } = await import("@/components/topology/device-drawer")
    const observation: TopologyObservation = {
      deviceId: "dev-b",
      hostname: "core-b",
      online: true,
      collectedAt: "2026-01-01T00:00:00.000Z",
      error: null,
      peerId: 2002,
      virtualIpv4: "10.0.0.3",
      version: "2.6.4-81487c36",
      natType: "PortRestricted",
      tcpNatType: "Symmetric",
      publicIps: ["203.0.113.20"],
      listeners: ["tcp://0.0.0.0:11022"],
      events: ["peer added"],
      peers: [
        {
          peerId: 1001,
          connId: "conn-1",
          protocol: "tcp",
          rawTunnelType: "tcp",
          localAddr: "tcp://172.28.0.3:1234",
          remoteAddr: "tcp://172.28.0.2:11021",
          latencyMs: 0.7,
          lossPercent: 0,
          rxBytes: "10",
          txBytes: "20",
          rxPackets: "1",
          txPackets: "2",
          isClient: true,
          isClosed: false,
          direct: true,
          networkName: "net",
        },
      ],
      routes: [
        {
          peerId: 2003,
          virtualIpv4: "10.0.0.4",
          hostname: "core-c",
          version: "2.6.4-81487c36",
          cost: 2,
          pathLatencyMs: 2,
          nextHopPeerId: 1001,
          nextHopHostname: null,
          proxyCidrs: [],
          natType: "PortRestricted",
          tcpNatType: "Symmetric",
          isPublicServer: false,
          avoidRelayData: false,
        },
      ],
    }
    render(
      <DeviceDrawer
        links={[]}
        node={node({
          deviceId: "dev-b",
          hostname: "core-b",
          natType: "PortRestricted",
          publicIps: ["203.0.113.20"],
        })}
        nodes={[node({ deviceId: "dev-b", hostname: "core-b" })]}
        onOpenChange={() => undefined}
        open
        observation={observation}
      />
    )
    expect(await screen.findByText("Raw peer connections")).toBeInTheDocument()
    expect(screen.getByText("203.0.113.20")).toBeInTheDocument()
    expect(screen.getByText("1001 · direct")).toBeInTheDocument()
    expect(screen.getByText("core-c")).toBeInTheDocument()
    expect(screen.getByText("Next hop")).toBeInTheDocument()
  })
})
