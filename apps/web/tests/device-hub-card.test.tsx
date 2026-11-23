import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { DeviceHubCard } from "@/components/device/device-hub-card"
import type { GetDevice200 } from "@/api/generated/model"
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

const DEVICE: GetDevice200 = {
  id: "8a2f1b0e-0000-4000-8000-000000000011",
  networkId: "8a2f1b0e-0000-4000-8000-000000000010",
  networkName: "Home",
  state: "approved",
  online: "online",
  sync: "in-sync",
  label: "hub-node",
  machineId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  hostname: "hub-node",
  dnsName: "hub-node",
  magicDnsName: "hub-node.et.net",
  magicDnsZone: "et.net.",
  magicDnsEnabled: true,
  easytierVersion: "2.6.4",
  os: { type: "linux", version: "6.8", distribution: "debian" },
  sourceIp: "127.0.0.1",
  virtualIpv4: "10.144.144.2",
  inviteId: null,
  ownerUserId: null,
  advertisedEndpoints: [],
  listenPort: null,
  externalPort: null,
  publicIps: [],
  isHub: false,
  wgListenPort: null,
  wireguardClientCount: 0,
  role: "anchor",
  effectiveRole: "anchor",
  knowsSecret: true,
  accessMode: "shared_secret",
  credential: null,
  tags: [],
  exitNode: "none",
  configManagedLocally: false,
  reportedState: {},
  reportedStateAt: null,
  desiredRevision: 1,
  appliedRevision: 1,
  policyVersion: 0,
  appliedAt: null,
  lastPushAt: null,
  lastPushError: null,
  lastSeenAt: null,
  approvedAt: null,
  blockedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
}

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
        : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("DeviceHubCard", () => {
  it("shows hub settings only while the device is a hub", () => {
    stubApi()
    const first = renderWithProviders(<DeviceHubCard device={DEVICE} />)
    expect(screen.queryByLabelText("Listen port")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Additional advertised addresses")
    ).not.toBeInTheDocument()
    first.unmount()

    renderWithProviders(<DeviceHubCard device={{ ...DEVICE, isHub: true }} />)
    expect(screen.getByLabelText("Listen port")).toBeInTheDocument()
    expect(
      screen.getByText("Additional advertised addresses")
    ).toBeInTheDocument()
  })

  it("uses the current listen port as the external port placeholder", async () => {
    stubApi()
    const user = userEvent.setup({ document })
    renderWithProviders(
      <DeviceHubCard
        device={{
          ...DEVICE,
          isHub: true,
          listenPort: 12000,
          externalPort: null,
          publicIps: ["203.0.113.5"],
        }}
      />
    )

    expect(screen.getByLabelText("Listen port")).toHaveValue(12000)
    const external = screen.getByLabelText("External port")
    expect(external).toHaveValue(null)
    expect(external).toHaveAttribute("placeholder", "12000")

    const listen = screen.getByLabelText("Listen port")
    await waitFor(() => expect(listen).toBeEnabled())
    await user.clear(listen)
    await user.type(listen, "13000")
    expect(screen.getByLabelText("External port")).toHaveAttribute(
      "placeholder",
      "13000"
    )
    // The detected address follows the draft, so nobody has to guess.
    expect(screen.getByText("tcp://203.0.113.5:13000")).toBeInTheDocument()
  })

  it("explains every address kind in the info tooltip", async () => {
    stubApi()
    const user = userEvent.setup({ document })
    renderWithProviders(<DeviceHubCard device={{ ...DEVICE, isHub: true }} />)

    const info = screen.getByRole("button", {
      name: "Which addresses can I add?",
    })
    await user.hover(info)
    await waitFor(() =>
      expect(screen.getByText("One address per line")).toBeInTheDocument()
    )
    expect(screen.getByText(/the usual choice/)).toBeInTheDocument()
    expect(screen.getByText("wss://example.com:443")).toBeInTheDocument()
    expect(screen.getByText(/WireGuard address/)).toBeInTheDocument()
    expect(screen.getByText(/public IP is not known yet/i)).toBeInTheDocument()

    // A tap/click opens the hint too (mobile has no hover).
    await user.unhover(info)
    await waitFor(() =>
      expect(
        screen.queryByText("One address per line")
      ).not.toBeInTheDocument()
    )
    await user.click(info)
    await waitFor(() =>
      expect(screen.getByText("One address per line")).toBeInTheDocument()
    )
  })
})
