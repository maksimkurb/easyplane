import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { NetworkDevicesPage } from "@/pages/network-devices-page"
import { renderWithProviders } from "./test-utils"
import {
  makeDevice,
  makeNetwork,
  type Device,
  type Network,
} from "./network-devices-page.fixtures"

const NETWORK_ID = "8a2f1b0e-0000-4000-8000-000000000010"

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
    id: "d-nas",
    hostname: "nas-01",
    dnsName: "nas-01",
    virtualIpv4: "10.144.144.2",
    online: "online",
    sync: "in-sync",
    isHub: true,
    tags: ["tag:server"],
  }),
  makeDevice({
    id: "d-relay",
    hostname: "relay-fra",
    dnsName: "relay-fra",
    virtualIpv4: "10.144.144.3",
    online: "online",
    sync: "stale",
    lastPushError: "listener in use",
  }),
  makeDevice({
    id: "d-laptop",
    hostname: "laptop-maxim",
    dnsName: "laptop-maxim",
    virtualIpv4: "10.144.144.7",
    online: "offline",
    sync: "error",
    lastPushError: "connection refused",
  }),
  makeDevice({
    id: "d-pending",
    hostname: "pixel-8",
    dnsName: "pixel-8",
    state: "pending",
    online: "offline",
    sync: "not-applicable",
    virtualIpv4: null,
  }),
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
        : url.startsWith(`/api/networks/${NETWORK_ID}/routes`)
          ? {
              routes: [
                {
                  id: "r1",
                  networkId: NETWORK_ID,
                  deviceId: "d-nas",
                  deviceHostname: "nas-01",
                  kind: "subnet",
                  cidr: "10.20.0.0/16",
                  state: "approved",
                  note: "",
                  requestedBy: null,
                  decidedBy: null,
                  decidedAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
              reports: [],
            }
          : url.startsWith(`/api/networks/${NETWORK_ID}/invites`)
            ? []
            : url.startsWith("/api/devices")
              ? devices
              : url.startsWith(`/api/networks/${NETWORK_ID}`)
                ? network
                : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("NetworkDevicesPage", () => {
  it("searches by name and filters by online or issues", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(<NetworkDevicesPage networkId={NETWORK_ID} />)

    expect(
      await screen.findByRole("link", { name: "Open nas-01" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Open relay-fra" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Open laptop-maxim" })
    ).toBeInTheDocument()

    // One derived status per row: the online device is connected, the failing
    // push is the only attention item, and the offline row is not blamed.
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Push failed")).toHaveLength(1)
    expect(screen.queryByText("tag:server")).not.toBeInTheDocument()
    expect(screen.getByText("server")).toBeInTheDocument()

    // Pending devices live in the approvals block, not in the list.
    expect(screen.getByText("Needs your approval")).toBeInTheDocument()

    const search = screen.getByRole("searchbox", { name: "Search devices" })
    await user.type(search, "relay")
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Open nas-01" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("link", { name: "Open relay-fra" })
    ).toBeInTheDocument()

    await user.clear(search)
    await user.click(screen.getByRole("radio", { name: /Needs attention/ }))
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Open nas-01" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("link", { name: "Open relay-fra" })
    ).toBeInTheDocument()
    // Offline devices are their own filter, not an "issue".
    expect(
      screen.queryByRole("link", { name: "Open laptop-maxim" })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("radio", { name: /Offline/ }))
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Open relay-fra" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("link", { name: "Open laptop-maxim" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("radio", { name: /Online/ }))
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Open laptop-maxim" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("link", { name: "Open nas-01" })
    ).toBeInTheDocument()
  })
})
