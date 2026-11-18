import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"

import { NetworksPage } from "@/pages/networks-page"
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

const NETWORK = {
  id: "8a2f1b0e-0000-4000-8000-000000000010",
  name: "Home lab",
  networkName: "homelab-7f3a91",
  ipv4Cidr: "10.144.144.0/24",
  deviceCounts: { approved: 3, pending: 1, blocked: 0 },
}

function stubApi(networks: unknown[] = []) {
  const fetchMock = async (input: RequestInfo | URL) => {
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
        : url.startsWith("/api/networks")
          ? networks
          : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  globalThis.fetch = fetchMock as typeof fetch
}

describe("NetworksPage", () => {
  it("links the import action to the dedicated import page", async () => {
    stubApi()
    renderWithProviders(<NetworksPage />)

    const link = await screen.findByRole("link", { name: /Import network/i })
    expect(link).toHaveAttribute("href", "/networks/import")
  })

  it("offers a first-network action when there are no networks", async () => {
    stubApi()
    renderWithProviders(<NetworksPage />)

    expect(await screen.findByText("No networks yet")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Create your first network" })
    ).toBeInTheDocument()
  })

  it("pluralises the summary with i18next plural rules", async () => {
    stubApi([NETWORK])
    renderWithProviders(<NetworksPage />)

    expect(await screen.findByText("1 network · 0 devices")).toBeInTheDocument()
    expect(screen.getByText("Home lab")).toBeInTheDocument()
    expect(screen.getAllByText("10.144.144.0/24").length).toBeGreaterThan(0)
    expect(screen.getAllByText("1 waiting").length).toBeGreaterThan(0)
  })
})
