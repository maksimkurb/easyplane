import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { WireguardPortalCard } from "@/components/device/wireguard-portal-card"
import { renderWithProviders } from "./test-utils"
import { makeDevice, makeNetwork, type Device } from "./network-devices-page.fixtures"

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

const network = makeNetwork({ id: NETWORK_ID })

function hub(overrides: Partial<Device> = {}): Device {
  return makeDevice({
    id: HUB_ID,
    hostname: "wg-hub",
    dnsName: "wg-hub",
    isHub: true,
    easytierVersion: "2.6.4-8428a89d",
    wgListenPort: 11013,
    wgPortalMode: "legacy",
    wgPortalState: "running",
    wgLegacyClientCidr: "10.14.14.0/24",
    ...overrides,
  })
}

function stubApi(options: { portalState?: string; config?: string } = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? "GET").toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      })
    if (url.endsWith("/api/auth/me")) return json(ADMIN)
    if (url.endsWith("/api/config")) return json({ providers: [] })
    if (url.includes("/wireguard-portal/config")) {
      return options.config
        ? json({
            config: options.config,
            filename: "wg-hub.conf",
            mode: "legacy",
            port: 11013,
            clientCidr: "10.14.14.0/24",
            connectedClients: ["10.14.14.2"],
            listener: null,
          })
        : json({ error: "portal not running", code: "wireguard_portal_not_running" }, 409)
    }
    if (url.endsWith("/push")) {
      return json({ status: "pushed" })
    }
    if (url.includes("/wireguard-clients")) return json([])
    if (url.startsWith("/api/networks/")) return json(network)
    if (url.startsWith("/api/devices")) return json([hub()])
    return json([])
  }) as typeof fetch
  return calls
}

describe("WireGuard portal card states", () => {
  it("shows the subnet generation and a shared config action for 2.6.4", async () => {
    stubApi()
    renderWithProviders(<WireguardPortalCard device={hub()} />)

    expect(
      await screen.findByText(/WireGuard mode: subnet/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/2\.6\.4/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Show shared configuration/i })
    ).toBeInTheDocument()
    // Per-client management is not offered at all on this generation.
    expect(screen.queryByRole("button", { name: /Add WireGuard client/i })).toBeNull()
    expect(screen.getByLabelText("Client subnet")).toHaveValue("10.14.14.0/24")
    expect(screen.getByText(/--vpn-portal wg:\/\/0\.0\.0\.0:11013/)).toBeInTheDocument()
  })

  it("explains that the build has no WireGuard support", async () => {
    stubApi()
    renderWithProviders(
      <WireguardPortalCard
        device={hub({
          wgPortalMode: "per-client",
          easytierVersion: "2.7.1",
          wgPortalState: "unsupported",
          wgPortalError: "this EasyTier build has no WireGuard support",
        })}
      />
    )
    expect(
      (await screen.findAllByText(/This EasyTier build has no WireGuard support/i)).length
    ).toBeGreaterThan(0)
    expect(
      screen.getByText(/Install or update to a build compiled with WireGuard support/i)
    ).toBeInTheDocument()
  })

  it("offers per-client management on a 2.7.x hub", async () => {
    stubApi()
    renderWithProviders(
      <WireguardPortalCard
        device={hub({
          easytierVersion: "2.7.1",
          wgPortalMode: "per-client",
          wgPortalState: "running",
          wgLegacyClientCidr: null,
        })}
      />
    )
    expect(
      await screen.findByText(/WireGuard mode: per-client/i)
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Client subnet")).toBeNull()
    expect(
      await screen.findByRole("button", { name: /Add WireGuard client/i })
    ).toBeInTheDocument()
  })

  it("shows a calm drift notice and retries on demand", async () => {
    const calls = stubApi()
    const user = userEvent.setup({ document })
    renderWithProviders(
      <WireguardPortalCard
        device={hub({
          easytierVersion: "2.7.1",
          wgPortalMode: "per-client",
          wgPortalState: "running",
          wgLegacyClientCidr: null,
          sync: "stale",
          driftReason: "vpnPortalConfig: missing on the client",
          driftAttempts: 2,
          driftRetryAt: new Date(Date.now() + 60_000).toISOString(),
        })}
      />
    )

    expect(
      await screen.findByText(/The device keeps reporting a different configuration/i)
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Retry now/i }))
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === "POST" && call.url.endsWith(`/api/devices/${HUB_ID}/push`)
        )
      ).toBe(true)
    )
  })

  it("shows the device's own apply error verbatim", async () => {
    stubApi()
    renderWithProviders(
      <WireguardPortalCard
        device={hub({
          easytierVersion: "2.7.1",
          wgPortalMode: "per-client",
          wgPortalState: "error",
          wgPortalError:
            "failed to create instance: VPN portal client keen-h2 has an unusable virtual IP 10.144.144.8",
          lastPushError:
            "failed to create instance: VPN portal client keen-h2 has an unusable virtual IP 10.144.144.8",
          sync: "error",
        })}
      />
    )
    expect(
      await screen.findByText(/The device rejected the configuration/i)
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/unusable virtual IP 10\.144\.144\.8/).length
    ).toBeGreaterThan(0)
    expect(
      screen.getByRole("button", { name: /Retry now/i })
    ).toBeInTheDocument()
  })

  it("opens the shared config dialog and shows the ready config", async () => {
    stubApi({ config: "[Interface]\nPrivateKey = topsecret\n" })
    const user = userEvent.setup({ document })
    renderWithProviders(<WireguardPortalCard device={hub()} />)

    await user.click(
      await screen.findByRole("button", { name: /Show shared configuration/i })
    )
    expect(
      await screen.findByText(/Portal address pool: 10\.14\.14\.0\/24/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument()
    expect(screen.getByText(/Connected clients: 1/i)).toBeInTheDocument()
  })
})
