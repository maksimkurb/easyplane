import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AuditPage } from "@/pages/audit-page"
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

const now = Date.now()

const entries = [
  {
    id: "a1",
    actorUserId: null,
    actorType: "system",
    action: "device.config.pushed",
    targetType: "device",
    targetId: "d-owrt",
    metadata: {},
    createdAt: new Date(now - 60_000).toISOString(),
  },
  {
    id: "a2",
    actorUserId: null,
    actorType: "system",
    action: "device.config.pushed",
    targetType: "device",
    targetId: "d-nas",
    metadata: {},
    createdAt: new Date(now - 120_000).toISOString(),
  },
  {
    id: "a3",
    actorUserId: "u1",
    actorType: "user",
    action: "device.approved",
    targetType: "device",
    targetId: "d-owrt",
    metadata: {},
    createdAt: new Date(now - 180_000).toISOString(),
  },
  {
    id: "a4",
    actorUserId: "u1",
    actorType: "user",
    action: "auth.login",
    targetType: "",
    targetId: "",
    metadata: {},
    createdAt: new Date(now - 240_000).toISOString(),
  },
  {
    id: "a5",
    actorUserId: "u1",
    actorType: "user",
    action: "custom.thing",
    targetType: "device",
    targetId: "d-owrt",
    metadata: {},
    createdAt: new Date(now - 300_000).toISOString(),
  },
]

const devices = [
  makeDevice({ id: "d-owrt", hostname: "router-3sad", dnsName: "owrt-h1" }),
  makeDevice({ id: "d-nas", hostname: "nas-01", dnsName: "nas-01" }),
]
const network = makeNetwork({ id: NETWORK_ID, name: "Home lab" })

function stubApi(data: typeof entries = entries) {
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
        : url.startsWith("/api/audit")
          ? data
          : url.startsWith("/api/users")
            ? [
                {
                  id: "u1",
                  email: "admin@example.com",
                  displayName: "Admin",
                  role: "admin",
                },
              ]
            : url.startsWith("/api/devices")
              ? devices
              : url.startsWith("/api/networks")
                ? [network]
                : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

function rowTexts(): string[] {
  return screen.getAllByRole("listitem").map((row) => row.textContent ?? "")
}

describe("AuditPage", () => {
  it("renders human sentences, groups system pushes and links targets", async () => {
    stubApi()
    renderWithProviders(<AuditPage />)

    expect(await screen.findByText("Activity")).toBeInTheDocument()
    await waitFor(() => {
      expect(
        rowTexts().some((row) => row.includes("Config pushed to 2 devices"))
      ).toBe(true)
    })
    expect(
      rowTexts().some((row) => row.includes("Admin approved owrt-h1"))
    ).toBe(true)
    expect(rowTexts().some((row) => row.includes("Admin signed in"))).toBe(true)

    const link = screen.getAllByRole("link", { name: "owrt-h1" })[0]
    expect(link).toHaveAttribute("href", "/devices/d-owrt")

    const times = document.querySelectorAll("time")
    expect(times.length).toBeGreaterThan(0)
    expect(times[0]).toHaveAttribute("title")
  })

  it("falls back to a readable form for unknown event types", async () => {
    stubApi()
    renderWithProviders(<AuditPage />)

    await screen.findByText("Activity")
    await waitFor(() => {
      expect(rowTexts().some((row) => row.includes("Custom thing"))).toBe(true)
    })
    expect(rowTexts().some((row) => row.includes("custom.thing"))).toBe(false)
  })

  it("filters by event type", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(<AuditPage />)

    await screen.findByText("Activity")
    await waitFor(() => {
      expect(rowTexts().some((row) => row.includes("Admin signed in"))).toBe(
        true
      )
    })

    await user.click(screen.getByRole("radio", { name: /^Devices/ }))

    await waitFor(() => {
      expect(rowTexts().some((row) => row.includes("Admin signed in"))).toBe(
        false
      )
    })
    expect(
      rowTexts().some((row) => row.includes("Admin approved owrt-h1"))
    ).toBe(true)
  })

  it("collapses repeated reports and groups entries by day", async () => {
    const recent = Date.now()
    stubApi([
      {
        id: "r1",
        actorUserId: null,
        actorType: "device",
        action: "route.unapproved_reported",
        targetType: "device",
        targetId: "d-nas",
        metadata: {},
        createdAt: new Date(recent - 60_000).toISOString(),
      },
      {
        id: "r2",
        actorUserId: null,
        actorType: "device",
        action: "route.unapproved_reported",
        targetType: "device",
        targetId: "d-nas",
        metadata: {},
        createdAt: new Date(recent - 120_000).toISOString(),
      },
      {
        id: "r3",
        actorUserId: null,
        actorType: "device",
        action: "route.unapproved_reported",
        targetType: "device",
        targetId: "d-nas",
        metadata: {},
        createdAt: new Date(recent - 180_000).toISOString(),
      },
      {
        id: "r4",
        actorUserId: "u1",
        actorType: "user",
        action: "auth.login",
        targetType: "",
        targetId: "",
        metadata: {},
        createdAt: new Date(recent - 86_400_000).toISOString(),
      },
    ])
    renderWithProviders(<AuditPage />)

    expect(await screen.findByText("Activity")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText("×3")).toBeInTheDocument()
    })
    expect(screen.getByText("Today")).toBeInTheDocument()
    expect(screen.getByText("Yesterday")).toBeInTheDocument()
    const reports = rowTexts().filter((row) =>
      row.includes("reported a route that is not approved")
    )
    expect(reports).toHaveLength(1)
  })
})
