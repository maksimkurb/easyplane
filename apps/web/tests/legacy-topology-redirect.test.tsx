import { beforeEach, describe, expect, it } from "vitest"
import { waitFor } from "@testing-library/react"

import { LegacyTopologyRedirect } from "@/pages/legacy-topology-redirect"
import { renderWithProviders } from "./test-utils"
import { makeNetwork } from "./network-devices-page.fixtures"

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

const FIRST = makeNetwork({
  id: "8a2f1b0e-0000-4000-8000-000000000010",
  name: "Home lab",
})
const SECOND = makeNetwork({
  id: "8a2f1b0e-0000-4000-8000-000000000011",
  name: "Office",
})

function stubApi(networks: unknown[]) {
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
        : url.startsWith("/api/networks")
          ? networks
          : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("LegacyTopologyRedirect", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/topology")
  })

  it("opens the only network's map", async () => {
    stubApi([FIRST])
    renderWithProviders(<LegacyTopologyRedirect />)

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/networks/${FIRST.id}/map`)
    })
  })

  it("falls back to the network list when there is more than one network", async () => {
    stubApi([FIRST, SECOND])
    renderWithProviders(<LegacyTopologyRedirect />)

    await waitFor(() => {
      expect(window.location.pathname).toBe("/networks")
    })
  })

  it("honours a deep link to one network", async () => {
    window.history.replaceState(null, "", `/topology?network=${SECOND.id}`)
    stubApi([FIRST, SECOND])
    renderWithProviders(<LegacyTopologyRedirect />)

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/networks/${SECOND.id}/map`)
    })
  })
})
