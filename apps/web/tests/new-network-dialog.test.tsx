import { afterEach, describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import i18n from "@/i18n"
import { NewNetworkDialog } from "@/components/network/new-network-dialog"
import { renderWithProviders } from "./test-utils"

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

const EXISTING = {
  id: "network-1",
  name: "Existing",
  networkName: "existing-1",
  ipv4Cidr: "10.144.144.0/24",
  deviceCounts: { approved: 0, pending: 0, blocked: 0 },
}

const CREATED = {
  ...EXISTING,
  id: "network-2",
  name: "Acme network",
  networkName: "acme-2",
  ipv4Cidr: "10.145.144.0/24",
}

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
    } else if (url.endsWith("/api/networks") && init?.method === "POST") {
      body = CREATED
    } else if (url.endsWith("/api/networks")) {
      body = [EXISTING]
    }
    return new Response(JSON.stringify(body), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return calls
}

describe("NewNetworkDialog", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en")
  })

  it("suggests a name and a free private range, with advanced options collapsed", async () => {
    stubApi()
    renderWithProviders(
      <NewNetworkDialog onOpenChange={() => undefined} open />
    )

    expect(await screen.findByDisplayValue("Acme network")).toBeInTheDocument()
    // 10.144.144.0/24 is taken, so the next free /24 is suggested.
    expect(
      await screen.findByDisplayValue("10.145.144.0/24")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Generated automatically after creation")
    ).not.toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Advanced options/ }))
    expect(
      screen.getAllByText("Generated automatically after creation").length
    ).toBeGreaterThan(0)
  })

  it("explains an invalid range in plain words and blocks Continue", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(
      <NewNetworkDialog onOpenChange={() => undefined} open />
    )

    const range = await screen.findByLabelText("Address range")
    await user.clear(range)
    await user.type(range, "8.8.8.0/24")

    expect(await screen.findByText(/Use a private range/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
  })

  it("reviews and creates the network with the chosen values", async () => {
    const calls = stubApi()
    const user = userEvent.setup()
    renderWithProviders(
      <NewNetworkDialog onOpenChange={() => undefined} open />
    )

    const name = await screen.findByLabelText("Network name")
    await waitFor(() =>
      expect(screen.getByDisplayValue("10.145.144.0/24")).toBeInTheDocument()
    )
    await user.clear(name)
    await user.type(name, "Family mesh")

    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(
      await screen.findByRole("heading", { name: "Check before you create" })
    ).toBeInTheDocument()
    expect(screen.getByText("Family mesh")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Create network" }))
    await waitFor(() => {
      const call = calls.find(
        (entry) =>
          entry.url.endsWith("/api/networks") && entry.init?.method === "POST"
      )
      expect(call).toBeDefined()
      expect(JSON.parse(String(call?.init?.body))).toMatchObject({
        name: "Family mesh",
        ipv4Cidr: "10.145.144.0/24",
      })
    })
  })
})
