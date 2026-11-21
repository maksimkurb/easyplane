import { afterEach, describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import i18n from "@/i18n"
import { NetworkSettingsPage } from "@/pages/network-settings-page"
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
  policyMode: "open",
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
  deviceCounts: { approved: 1, pending: 0, blocked: 0 },
}

const INVITES = [
  {
    id: "invite-1",
    networkId: NETWORK_ID,
    label: "Family phones",
    role: "member",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    maxUses: 5,
    uses: 1,
    reusable: true,
    remainingUses: 4,
    status: "active",
    revokedAt: null,
    lastUsedAt: null,
  },
  {
    id: "invite-2",
    networkId: NETWORK_ID,
    label: "Old tablet",
    role: "member",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    maxUses: 1,
    uses: 1,
    reusable: false,
    remainingUses: 0,
    status: "active",
    revokedAt: null,
    lastUsedAt: null,
  },
]

function stubApi() {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    let body: unknown = []
    if (url.endsWith("/api/auth/me")) body = ADMIN
    else if (url.endsWith("/api/config")) {
      body = {
        orgName: "Acme",
        publicUrl: null,
        publicConfigServerUrl: null,
        bootstrapAvailable: false,
        providers: [],
      }
    } else if (url.endsWith(`/api/networks/${NETWORK_ID}/routes`)) {
      body = { routes: [], reports: [] }
    } else if (url.endsWith(`/api/networks/${NETWORK_ID}/dns`)) {
      body = {
        enabled: true,
        zone: "et.net",
        clientFlag: "--tld-dns-zone et.net",
        defaultZone: "et.net",
        names: [],
      }
    } else if (url.endsWith(`/api/networks/${NETWORK_ID}/peers`)) {
      body = { peers: [] }
    } else if (url.endsWith(`/api/networks/${NETWORK_ID}/invites`)) {
      body = INVITES
    } else if (url.endsWith(`/api/networks/${NETWORK_ID}`)) {
      body = NETWORK
    } else if (url.endsWith("/api/networks")) {
      body = [NETWORK]
    } else if (url.startsWith("/api/devices")) {
      body = []
    }
    return new Response(JSON.stringify(body), {
      status: init?.method === "PATCH" || init?.method === "DELETE" ? 200 : 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return calls
}

describe("NetworkSettingsPage", () => {
  afterEach(async () => {
    window.localStorage.clear()
    await i18n.changeLanguage("en")
  })

  it("uses one section nav and a single save model for text fields", async () => {
    const calls = stubApi()
    const user = userEvent.setup()
    renderWithProviders(<NetworkSettingsPage networkId={NETWORK_ID} />)

    const nav = await screen.findByRole("navigation", {
      name: "Settings sections",
    })
    expect(
      within(nav).getByRole("button", { name: "General" })
    ).toHaveAttribute("aria-current", "page")
    expect(screen.getAllByText("homelab-7f3a91").length).toBeGreaterThan(0)

    const name = await screen.findByLabelText("Display name")
    await user.clear(name)
    await user.type(name, "Home network")

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => {
      const patch = calls.find((entry) => entry.init?.method === "PATCH")
      expect(patch).toBeDefined()
      expect(JSON.parse(String(patch?.init?.body))).toMatchObject({
        name: "Home network",
      })
    })
  })

  it("shows invite status without the one-time token warning", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(<NetworkSettingsPage networkId={NETWORK_ID} />)

    const nav = await screen.findByRole("navigation", {
      name: "Settings sections",
    })
    await user.click(within(nav).getByRole("button", { name: "Invites" }))

    expect(await screen.findByText("Family phones")).toBeInTheDocument()
    expect(screen.getByText(/1 of 5 used/)).toBeInTheDocument()
    expect(screen.getAllByText(/New devices need approval/).length).toBeGreaterThan(0)
    // An exhausted link shows its status instead of a misleading expiry date.
    expect(screen.getByText("Old tablet")).toBeInTheDocument()
    expect(screen.getByText(/This link no longer works/)).toBeInTheDocument()
    expect(screen.queryByText(/Copy the token now/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Create invite with Add device" })
    ).toBeInTheDocument()
  })

  it("requires the network name before deleting and keeps Cancel as the default", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(<NetworkSettingsPage networkId={NETWORK_ID} />)

    const nav = await screen.findByRole("navigation", {
      name: "Settings sections",
    })
    await user.click(within(nav).getByRole("button", { name: "Danger zone" }))
    await user.click(screen.getByRole("button", { name: "Delete network" }))

    expect(await screen.findByText("Delete this network?")).toBeInTheDocument()
    const dialog = screen.getByRole("dialog")
    expect(
      within(dialog).getByText(/disconnects all 1 devices/i)
    ).toBeInTheDocument()

    const confirm = within(dialog).getByRole("button", {
      name: "Delete network",
    })
    expect(confirm).toBeDisabled()

    const field = within(dialog).getByPlaceholderText("Home lab")
    await user.type(field, "Home lab")
    expect(confirm).toBeEnabled()
    expect(
      within(dialog).getByRole("button", { name: "Cancel" })
    ).toBeInTheDocument()
  })

  it("keeps jargon out of the connectivity and DNS sections", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(<NetworkSettingsPage networkId={NETWORK_ID} />)

    const nav = await screen.findByRole("navigation", {
      name: "Settings sections",
    })
    await user.click(within(nav).getByRole("button", { name: "Connectivity" }))

    expect(
      await screen.findByText("Direct connections only")
    ).toBeInTheDocument()
    expect(screen.queryByText(/p2p_only/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/never sent back to that device/)
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/turned on from any device page/i)
    ).toBeInTheDocument()

    await user.click(within(nav).getByRole("button", { name: "DNS" }))
    expect(await screen.findByText(/Device names/)).toBeInTheDocument()
    expect(screen.queryByText(/database index/)).not.toBeInTheDocument()
  })
})
