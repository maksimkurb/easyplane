import { afterEach, describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { NetworkShell } from "@/components/network/network-shell"
import { renderWithProviders } from "./test-utils"

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

const NETWORK = {
  id: NETWORK_ID,
  name: "Home lab",
  networkName: "homelab-7f3a91",
  ipv4Cidr: "10.144.144.0/24",
  magicDnsEnabled: false,
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
  deviceCounts: { approved: 0, pending: 0, blocked: 0 },
}

function stubApi() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
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
    } else if (url.endsWith(`/api/networks/${NETWORK_ID}`)) {
      body = NETWORK
    } else if (url.endsWith(`/api/networks/${NETWORK_ID}/invites`)) {
      body = []
    } else if (url.startsWith("/api/devices")) {
      body = []
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("NetworkShell", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/")
    window.localStorage.clear()
  })

  it("shows the setup checklist and opens Add device from ?addDevice=1", async () => {
    stubApi()
    window.history.replaceState({}, "", `/networks/${NETWORK_ID}?addDevice=1`)
    const user = userEvent.setup()
    renderWithProviders(
      <NetworkShell networkId={NETWORK_ID} tab="devices">
        {() => <p>Devices content</p>}
      </NetworkShell>
    )

    expect(await screen.findByText("Set up your network")).toBeInTheDocument()
    expect(
      await screen.findByText("Add a device to Home lab")
    ).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByText("Add a device to Home lab")
      ).not.toBeInTheDocument()
    )
    expect(window.location.search).toBe("")
  })
})
