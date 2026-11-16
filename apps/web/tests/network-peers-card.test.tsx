import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"

import { NetworkPeersCard } from "@/components/network-peers-card"
import { renderWithProviders } from "./test-utils"

const ADMIN = {
  user: {
    id: "8a2f1b0e-0000-4000-8000-000000000001",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    groups: [],
    bootstrap: false,
    lastLoginAt: null,
  },
  organisation: {
    id: "8a2f1b0e-0000-4000-8000-000000000002",
    name: "Acme",
    slug: "acme",
  },
  csrfToken: "csrf",
  providers: [],
}

const NETWORK = "8a2f1b0e-0000-4000-8000-000000000010"
const HUB = "8a2f1b0e-0000-4000-8000-000000000011"

const PEERS = {
  peers: [
    {
      id: "8a2f1b0e-0000-4000-8000-000000000020",
      networkId: NETWORK,
      position: 0,
      kind: "device",
      url: null,
      deviceId: HUB,
      deviceHostname: "hub-node",
      deviceDnsName: "hub-node",
      deviceMachineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deviceState: "approved",
      deviceIsHub: true,
      endpoints: ["tcp://hub.example.com:11010"],
      suggestedDeviceId: null,
      suggestedDeviceHostname: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "8a2f1b0e-0000-4000-8000-000000000021",
      networkId: NETWORK,
      position: 1,
      kind: "external",
      url: "tcp://legacy.example.com:11010",
      deviceId: null,
      deviceHostname: null,
      deviceDnsName: null,
      deviceMachineId: null,
      deviceState: null,
      deviceIsHub: false,
      endpoints: [],
      suggestedDeviceId: HUB,
      suggestedDeviceHostname: "hub-node",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
}

const DEVICES = [
  {
    id: HUB,
    networkId: NETWORK,
    hostname: "hub-node",
    dnsName: "hub-node",
    machineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    state: "approved",
    isHub: true,
    advertisedEndpoints: ["tcp://hub.example.com:11010"],
  },
]

function stubApi() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.endsWith("/api/auth/me")
      ? ADMIN
      : url.endsWith("/api/config")
        ? {
            orgName: "Acme",
            publicUrl: null,
            publicConfigServerUrl: null,
            bootstrapAvailable: false,
            providers: [],
          }
        : url.includes(`/api/networks/${NETWORK}/peers`)
          ? PEERS
          : url.includes("/api/devices")
            ? DEVICES
            : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("NetworkPeersCard", () => {
  it("shows device-backed and external entries with a link suggestion", async () => {
    stubApi()
    renderWithProviders(<NetworkPeersCard networkId={NETWORK} />)

    expect(await screen.findByRole("link", { name: "hub-node" })).toHaveAttribute(
      "href",
      `/devices/${HUB}`
    )
    expect(screen.getByText("tcp://hub.example.com:11010")).toBeInTheDocument()
    expect(
      screen.getByText("tcp://legacy.example.com:11010")
    ).toBeInTheDocument()
    expect(screen.getByText(/exactly matches the endpoint/i)).toBeInTheDocument()
    // Device-backed hubs and external URLs are distinguished.
    expect(screen.getByText("Hub")).toBeInTheDocument()
    expect(screen.getByText("External")).toBeInTheDocument()
    // Admin affordances.
    expect(
      screen.getByRole("button", { name: /Link to device/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/Add an external peer/i)).toBeInTheDocument()
  })
})
