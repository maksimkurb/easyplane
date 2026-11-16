import { describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { GetNetwork200 } from "@/api/generated/model"
import { AddDeviceDialog } from "@/components/invites/add-device-dialog"
import { renderWithProviders } from "./test-utils"

const NETWORK_ID = "8a2f1b0e-0000-4000-8000-000000000010"

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
  organisation: { id: "org", name: "Acme", slug: "acme" },
  csrfToken: "csrf",
  providers: [],
}

const NETWORK = {
  id: NETWORK_ID,
  name: "Home lab",
  networkName: "homelab-7f3a91",
  ipv4Cidr: "10.144.144.0/24",
  defaultConfig: {},
  magicDnsEnabled: true,
  magicDnsZone: "et.net",
  policyVersion: 0,
  useRendezvous: false,
  p2pOnly: false,
  access: {
    mode: "shared_secret",
    anchors: 0,
    onlineAnchors: 0,
    members: 0,
    activeCredentials: 0,
    expiringCredentials: 0,
    warnings: [],
  },
  rendezvous: {
    configured: false,
    useBundled: false,
    secretMatches: null,
    endpoints: [],
    relayData: false,
    privateMode: false,
    networkName: null,
  },
  peerPlan: {
    hubEndpoints: 0,
    rawPeers: 0,
    rendezvousEndpoints: 0,
    hasPeerEndpoint: false,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deviceCounts: { approved: 0, pending: 0, blocked: 0 },
} as unknown as GetNetwork200

function stubApi() {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const body = url.endsWith("/api/auth/me")
      ? ADMIN
      : url.endsWith("/api/config")
        ? {
            orgName: "Acme",
            publicUrl: null,
            publicConfigServerUrl: "https://plane.acme.test",
            bootstrapAvailable: false,
            providers: [],
          }
        : url.endsWith(`/api/networks/${NETWORK_ID}/invites`)
          ? {
              invite: {
                id: "invite-1",
                networkId: NETWORK_ID,
                label: "",
                role: "member",
                createdAt: "2026-01-01T00:00:00.000Z",
                expiresAt: null,
                maxUses: 25,
                uses: 0,
                reusable: true,
                remainingUses: 25,
                status: "active",
                revokedAt: null,
                lastUsedAt: null,
              },
              token: "ep_inv_test",
            }
          : []
    return new Response(JSON.stringify(body), {
      status: url.endsWith("/invites") ? 201 : 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return calls
}

describe("AddDeviceDialog", () => {
  it("maps custom uses and never-expiry onto the invite API", async () => {
    const calls = stubApi()
    const user = userEvent.setup()
    renderWithProviders(
      <AddDeviceDialog network={NETWORK} onOpenChange={() => undefined} open />
    )

    const uses = await screen.findByRole("radiogroup", { name: "Can be used" })
    await user.click(within(uses).getByRole("radio", { name: "Custom" }))
    const customUses = screen.getByRole("spinbutton", { name: "Maximum uses" })
    await user.clear(customUses)
    await user.type(customUses, "25")

    const expires = screen.getByRole("radiogroup", { name: "Expires" })
    await user.click(within(expires).getByRole("radio", { name: "Never" }))

    expect(screen.getByText("Up to 25 devices · never expires")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Create invite" }))

    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith("/invites"))
      expect(call).toBeDefined()
      const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({ maxUses: 25, expiresInHours: null })
    })

    // The token is shown once and the primary action becomes Done.
    expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument()
    expect(screen.getAllByText(/ep_inv_test/).length).toBeGreaterThan(0)
  })

  it("offers join and install modes and explains the missing installer", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(
      <AddDeviceDialog network={NETWORK} onOpenChange={() => undefined} open />
    )

    expect(await screen.findByRole("radio", { name: /Join/ })).toBeChecked()
    await user.click(screen.getByRole("radio", { name: /Install/ }))
    expect(screen.getByText(/Automatic install scripts are not available yet/)).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "Device system" })).toBeInTheDocument()
  })
})
