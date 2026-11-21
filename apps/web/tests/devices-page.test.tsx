import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { DevicesPage } from "@/pages/devices-page"
import { renderWithProviders } from "./test-utils"
import { makeDevice, makeNetwork } from "./network-devices-page.fixtures"

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

const network = makeNetwork({ id: NETWORK_ID, name: "Home lab" })

const devices = [
  makeDevice({
    id: "d-owrt",
    hostname: "router-3sad",
    dnsName: "owrt-h1",
    online: "online",
    state: "approved",
    sync: "in-sync",
  }),
  makeDevice({
    id: "d-nas",
    hostname: "nas-01",
    dnsName: "nas-01",
    online: "offline",
    state: "approved",
    sync: "stale",
  }),
  makeDevice({
    id: "d-pixel",
    hostname: "pixel-8",
    dnsName: "pixel-8",
    online: "offline",
    state: "pending",
    sync: "not-applicable",
    virtualIpv4: null,
  }),
]

function stubApi(
  list: typeof devices,
  users: Array<{
    id: string
    email: string
    displayName: string
    role: string
  }> = []
) {
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
        : url.startsWith("/api/devices")
          ? list
          : url.startsWith("/api/networks")
            ? [network]
            : url.startsWith("/api/users")
              ? users
              : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("DevicesPage", () => {
  it("shows the display name first and the hostname as secondary text", async () => {
    stubApi(devices)
    renderWithProviders(<DevicesPage />)

    const link = await screen.findByRole("link", { name: /owrt-h1/i })
    expect(link).toHaveAttribute("href", "/devices/d-owrt")
    expect(screen.getByText("router-3sad")).toBeInTheDocument()
    expect(
      screen.getAllByRole("link", { name: "Home lab" })[0]
    ).toHaveAttribute("href", `/networks/${NETWORK_ID}`)
  })

  it("filters with the segmented control and offers inline decisions", async () => {
    stubApi(devices)
    const user = userEvent.setup()
    renderWithProviders(<DevicesPage />)

    expect(
      await screen.findByRole("button", { name: "Approve pixel-8" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Reject pixel-8" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("radio", { name: /^Waiting for approval/ }))

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /owrt-h1/i })
      ).not.toBeInTheDocument()
    })
    expect(screen.getByRole("link", { name: /pixel-8/i })).toBeInTheDocument()
  })

  it("preselects Pending on the approvals route", async () => {
    stubApi(devices)
    renderWithProviders(<DevicesPage pendingOnly />)

    const pending = await screen.findByRole("radio", { name: /^Waiting for approval/ })
    expect(pending).toHaveAttribute("aria-checked", "true")
    expect(
      screen.queryByRole("link", { name: /owrt-h1/i })
    ).not.toBeInTheDocument()
  })

  it("shows only the pending empty state when there is nothing to approve", async () => {
    stubApi(devices.filter((device) => device.state !== "pending"))
    renderWithProviders(<DevicesPage pendingOnly />)

    expect(
      await screen.findByText("No devices are waiting for approval")
    ).toBeInTheDocument()
    expect(screen.queryByText("No devices yet")).not.toBeInTheDocument()
    // Nothing is filtered here, so there is nothing to reset.
    expect(
      screen.queryByRole("button", { name: "Clear filters" })
    ).not.toBeInTheDocument()
  })

  it("shows the owner's name instead of a raw id and normalises tags", async () => {
    stubApi(
      [
        makeDevice({
          id: "d-owned",
          hostname: "nas-02",
          dnsName: "nas-02",
          ownerUserId: "8a2f1b0e-0000-4000-8000-000000000001",
          tags: ["tag:kz"],
        }),
      ],
      [
        {
          id: "8a2f1b0e-0000-4000-8000-000000000001",
          email: "anna@example.com",
          displayName: "Anna",
          role: "admin",
        },
      ]
    )
    renderWithProviders(<DevicesPage />)

    expect(await screen.findByText("Owner Anna")).toBeInTheDocument()
    expect(screen.queryByText(/805e3206/)).not.toBeInTheDocument()
    expect(screen.getByText("kz")).toBeInTheDocument()
    expect(screen.queryByText("tag:kz")).not.toBeInTheDocument()
  })
})
