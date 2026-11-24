import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { WireguardAddDialog } from "@/components/device/wireguard-add-dialog"
import { WireguardStatus } from "@/components/device/wireguard-client-list"
import { WireguardBadge } from "@/components/device/wireguard-badge"
import { NetworkDevicesPage } from "@/pages/network-devices-page"
import type { ListWireguardClients200Item } from "@/api/generated/model"
import { renderWithProviders } from "./test-utils"
import {
  makeDevice,
  makeNetwork,
  type Device,
  type Network,
} from "./network-devices-page.fixtures"

const NETWORK_ID = "8a2f1b0e-0000-4000-8000-000000000010"
const HUB_ID = "8a2f1b0e-0000-4000-8000-000000000021"

const ADMIN = {
  user: {
    id: "u1",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    groups: [],
    bootstrap: false,
    lastLoginAt: null,
  },
  organisation: { id: "org", name: "Acme", slug: "acme" },
  csrfToken: "csrf",
  providers: [],
}

const network: Network = makeNetwork({ id: NETWORK_ID })
const devices: Device[] = [
  makeDevice({
    id: HUB_ID,
    hostname: "hub-01",
    dnsName: "hub-01",
    virtualIpv4: "10.144.144.2",
    isHub: true,
    wgListenPort: 11013,
  }),
]

const CLIENT: ListWireguardClients200Item = {
  id: "8a2f1b0e-0000-4000-8000-000000000031",
  networkId: NETWORK_ID,
  hubDeviceId: HUB_ID,
  hubHostname: "hub-01",
  name: "phone",
  virtualIpv4: "10.144.144.9",
  tags: ["tag:mobile"],
  ownerUserId: null,
  state: "online",
  endpoint: "198.51.100.9:51820",
  tunnelIp: "100.64.0.2",
  peerId: 7,
  error: null,
  statusAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
}

function stubApi(options: { clients?: ListWireguardClients200Item[] } = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? "GET").toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: method === "POST" ? 201 : 200,
        headers: { "content-type": "application/json" },
      })
    if (url.endsWith("/api/auth/me")) return json(ADMIN)
    if (url.endsWith("/api/config")) {
      return json({
        orgName: "Acme",
        publicUrl: null,
        publicConfigServerUrl: null,
        bootstrapAvailable: false,
        providers: [],
      })
    }
    if (url.endsWith("/api/tags")) {
      return json([
        {
          id: "tag-mobile",
          name: "tag:mobile",
          subject: "tag:mobile",
          color: "",
          deviceCount: 1,
          devices: [],
        },
      ])
    }
    if (url.includes("/wireguard-clients") && method === "POST") {
      return json({ ...CLIENT, name: body?.name ?? CLIENT.name })
    }
    if (url.includes("/wireguard-clients")) return json(options.clients ?? [])
    if (url.startsWith(`/api/networks/${NETWORK_ID}/routes`)) {
      return json({ routes: [], reports: [] })
    }
    if (url.startsWith(`/api/networks/${NETWORK_ID}/invites`)) return json([])
    if (url.startsWith("/api/devices")) return json(devices)
    if (url.startsWith(`/api/networks/${NETWORK_ID}`)) return json(network)
    return json([])
  }) as typeof fetch
  return calls
}

describe("WireGuard clients in the panel", () => {
  it("marks portal clients as a separate kind in the device list", async () => {
    stubApi({ clients: [CLIENT] })
    renderWithProviders(<NetworkDevicesPage networkId={NETWORK_ID} />)

    expect(await screen.findByText("WireGuard clients")).toBeInTheDocument()
    expect(await screen.findByText("phone")).toBeInTheDocument()
    // No per-row badge: the section heading already says what these are.
    expect(screen.queryAllByTitle("WireGuard")).toHaveLength(0)
    expect(screen.getByText("10.144.144.9")).toBeInTheDocument()
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0)
    expect(screen.getByText(/198\.51\.100\.9:51820/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "hub-01" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/devices\//)
    )
  })

  it("renders the offline and unknown states without pretending they are errors", () => {
    const { rerender } = renderWithProviders(
      <WireguardStatus
        client={{ ...CLIENT, state: "offline", endpoint: null }}
      />
    )
    expect(screen.getByText("Not connected")).toBeInTheDocument()

    rerender(
      <WireguardStatus
        client={{ ...CLIENT, state: "unknown", endpoint: null }}
      />
    )
    expect(screen.getByText("Status unknown")).toBeInTheDocument()

    rerender(
      <WireguardStatus
        client={{ ...CLIENT, state: "error", error: "handshake failed" }}
      />
    )
    expect(screen.getByText("Error")).toBeInTheDocument()
    expect(screen.getByText("handshake failed")).toBeInTheDocument()
  })

  it("shows the badge with an accessible label", () => {
    renderWithProviders(<WireguardBadge />)
    expect(screen.getByTitle("WireGuard")).toHaveTextContent("WireGuard")
  })

  it("creates a client from the dialog and opens its configuration", async () => {
    const calls = stubApi()
    const onCreated = vi.fn()
    const user = userEvent.setup({ document })
    renderWithProviders(
      <WireguardAddDialog
        hubs={[{ id: HUB_ID, name: "hub-01" }]}
        networkId={NETWORK_ID}
        onCreated={onCreated}
        onOpenChange={() => undefined}
        open
      />
    )

    const name = await screen.findByLabelText("Name")
    await user.type(name, "my-tablet")
    // The only tag in the stub becomes selectable.
    expect(await screen.findByText("mobile")).toBeInTheDocument()
    await user.click(screen.getByRole("checkbox"))
    await user.click(screen.getByRole("button", { name: "Create client" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    const post = calls.find(
      (call) => call.method === "POST" && call.url.includes("wireguard-clients")
    )
    expect(post?.body).toMatchObject({
      name: "my-tablet",
      tags: ["tag:mobile"],
      hubDeviceId: HUB_ID,
    })
  })

  it("cannot be created without a name", async () => {
    stubApi()
    renderWithProviders(
      <WireguardAddDialog
        hubs={[{ id: HUB_ID, name: "hub-01" }]}
        networkId={NETWORK_ID}
        onCreated={() => undefined}
        onOpenChange={() => undefined}
        open
      />
    )
    expect(
      await screen.findByRole("button", { name: "Create client" })
    ).toBeDisabled()
  })
})
