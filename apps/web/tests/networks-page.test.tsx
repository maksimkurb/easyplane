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

function stubApi() {
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
})
