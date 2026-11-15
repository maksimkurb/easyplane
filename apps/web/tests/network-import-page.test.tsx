import { afterEach, describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import i18n from "@/i18n"
import { NetworkImportPage } from "@/pages/network-import-page"
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

const CONFIG = {
  orgName: "Acme",
  publicUrl: null,
  publicConfigServerUrl: "wss://vpn.example.com",
  bootstrapAvailable: false,
  providers: [],
}

function stubApi({ devices = [] }: { devices?: unknown[] } = {}) {
  const fetchMock = async (input: RequestInfo | URL) => {
    const url = String(input)
    let body: unknown = []
    const status = 200

    if (url.endsWith("/api/auth/me")) {
      body = ADMIN
    } else if (url.endsWith("/api/config")) {
      body = CONFIG
    } else if (url.startsWith("/api/devices")) {
      body = devices
    } else if (url.startsWith("/api/networks")) {
      body = []
    } else if (url.includes("/adoptable-instances")) {
      body = []
    }

    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }
  globalThis.fetch = fetchMock as typeof fetch
}

function onlineDevice(id: string, hostname: string) {
  return {
    id,
    networkId: "8a2f1b0e-0000-4000-8000-000000000010",
    networkName: "office",
    state: "approved",
    online: "online",
    sync: "in-sync",
    label: "",
    machineId: id,
    hostname,
    dnsName: hostname,
    magicDnsName: hostname,
    magicDnsZone: "easyplane.local",
    magicDnsEnabled: false,
    easytierVersion: "2.4.0",
    os: { type: "linux", version: "6.6", distribution: "debian" },
    sourceIp: "10.0.0.1",
    virtualIpv4: "10.144.144.2",
    inviteId: null,
    ownerUserId: null,
    tags: [],
    reportedState: {},
    reportedStateAt: null,
    desiredRevision: 1,
    appliedRevision: 1,
    policyVersion: 0,
    appliedAt: null,
    lastPushAt: null,
    lastPushError: null,
    lastSeenAt: null,
    approvedAt: null,
  }
}

describe("NetworkImportPage", () => {
  afterEach(async () => {
    localStorage.removeItem("easyplane-language")
    await i18n.changeLanguage("en")
  })

  it("is a full page with TOML, share link and device sources and no secret field", async () => {
    stubApi()
    renderWithProviders(<NetworkImportPage />)

    expect(
      await screen.findByRole("heading", { name: /Import a network/i })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("tab", { name: /TOML config/i })
    ).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Share link/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /From a device/i })).toBeInTheDocument()
    expect(screen.getByLabelText("EasyTier TOML")).toBeInTheDocument()
    expect(screen.getByText(/never sent to this browser/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/network secret/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Preview import/i })
    ).toBeDisabled()
    expect(screen.getByText(/Nothing to preview yet/i)).toBeInTheDocument()
  })

  it("explains an empty device list instead of opening an empty select", async () => {
    stubApi()
    renderWithProviders(<NetworkImportPage />)

    await userEvent.click(
      await screen.findByRole("tab", { name: /From a device/i })
    )

    const select = screen.getByRole("combobox", { name: /Connected device/i })
    expect(select).toBeDisabled()
    expect(
      screen.getByText(/No connected devices; the device must be online and approved/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open devices/i })).toHaveAttribute(
      "href",
      "/devices"
    )
  })

  it("keeps the device select enabled when an online approved device exists", async () => {
    stubApi({ devices: [onlineDevice("device-1", "laptop")] })
    renderWithProviders(<NetworkImportPage />)

    await userEvent.click(
      await screen.findByRole("tab", { name: /From a device/i })
    )

    expect(
      await screen.findByRole("combobox", { name: /Connected device/i })
    ).toBeEnabled()
    expect(
      screen.queryByText(/No connected devices/i)
    ).not.toBeInTheDocument()
  })

  it("is translated into Russian", async () => {
    stubApi()
    localStorage.setItem("easyplane-language", "ru")
    renderWithProviders(<NetworkImportPage />)

    expect(
      await screen.findByRole("heading", { name: "Импорт сети" })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("tab", { name: /TOML-конфигурация/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Предпросмотр импорта/i })
    ).toBeDisabled()
  })
})
