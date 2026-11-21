import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { Sidebar } from "@/components/layout/sidebar"
import { renderWithProviders } from "./test-utils"
import { makeDevice, makeNetwork } from "./network-devices-page.fixtures"

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

const network = makeNetwork({
  id: "8a2f1b0e-0000-4000-8000-000000000010",
  name: "Home lab",
})

const pending = [
  makeDevice({
    id: "d1",
    hostname: "pixel-8",
    dnsName: "pixel-8",
    state: "pending",
  }),
  makeDevice({
    id: "d2",
    hostname: "ipad",
    dnsName: "ipad",
    state: "pending",
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
        : url.startsWith("/api/networks")
          ? [network]
          : url.startsWith("/api/devices")
            ? pending
            : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("Sidebar", () => {
  it("keeps global destinations and accounts visible without the avatar menu", async () => {
    stubApi()
    window.localStorage.clear()
    renderWithProviders(<Sidebar />)

    expect(
      await screen.findByRole("link", { name: "Networks" })
    ).toHaveAttribute("href", "/networks")
    expect(screen.getByRole("link", { name: "Devices" })).toHaveAttribute(
      "href",
      "/devices"
    )
    expect(
      await screen.findByRole("link", { name: "Home lab" })
    ).toHaveAttribute("href", `/networks/${network.id}`)
    expect(
      await screen.findByRole("link", { name: "Activity" })
    ).toHaveAttribute("href", "/audit")

    const approvals = screen.getByRole("link", {
      name: /Waiting for approval/,
    })
    expect(await within(approvals).findByText("2")).toBeInTheDocument()

    const account = screen.getByRole("button", {
      name: "Account, language and theme",
    })
    expect(account).toBeInTheDocument()
    expect(screen.getByText("admin@example.com")).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Topology" })
    ).not.toBeInTheDocument()
  })

  it("collapses to icons and remembers the choice", async () => {
    stubApi()
    window.localStorage.clear()
    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)

    const collapse = await screen.findByRole("button", {
      name: "Collapse navigation",
    })
    await user.click(collapse)

    expect(
      screen.getByRole("button", { name: "Expand navigation" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("link", { name: "Home lab" })
    ).not.toBeInTheDocument()
    expect(window.localStorage.getItem("easyplane-sidebar-collapsed")).toBe("1")
  })
})
