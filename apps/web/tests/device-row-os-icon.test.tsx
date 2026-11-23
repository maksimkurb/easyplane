import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"

import { DeviceRow } from "@/components/device/device-row"
import { renderWithProviders } from "./test-utils"
import { makeDevice } from "./network-devices-page.fixtures"

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

/** DeviceRow reads the session for its menu and the user list for owners. */
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
        : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("DeviceRow OS icon", () => {
  it("shows the glyph of the OS each device reports", async () => {
    stubApi()
    const openwrt = makeDevice({
      id: "d-owrt",
      hostname: "router-3sad",
      dnsName: "owrt-h1",
      os: { type: "linux", distribution: "OpenWrt", version: "25.12.5" },
    })
    const android = makeDevice({
      id: "d-pixel",
      hostname: "pixel-8",
      dnsName: "pixel-8",
      os: { type: "android", distribution: "Android", version: "15" },
    })

    renderWithProviders(
      <>
        <DeviceRow device={openwrt} networkId={openwrt.networkId} />
        <DeviceRow device={android} networkId={android.networkId} />
      </>
    )

    expect(
      await screen.findByRole("link", { name: "Open owrt-h1" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Open pixel-8" })
    ).toBeInTheDocument()
    expect(document.querySelector('[data-os-icon="openwrt"]')).not.toBeNull()
    expect(document.querySelector('[data-os-icon="android"]')).not.toBeNull()
  })
})
