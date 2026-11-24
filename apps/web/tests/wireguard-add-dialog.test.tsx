import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { WireguardAddDialog } from "@/components/device/wireguard-add-dialog"
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

function stubApi() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.endsWith("/api/auth/me")
      ? ADMIN
      : url.startsWith("/api/tags")
        ? [{ id: "t1", name: "ru", color: "", subject: "tag:ru", deviceCount: 2, devices: [] }]
        : []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("WireguardAddDialog tags", () => {
  it("toggles a tag by clicking its checkbox and its label", async () => {
    stubApi()
    const user = userEvent.setup()
    renderWithProviders(
      <WireguardAddDialog
        hubs={[{ id: "h1", name: "h-1" }]}
        networkId="n1"
        onCreated={() => undefined}
        onOpenChange={() => undefined}
        open
      />
    )
    const box = await screen.findByRole("checkbox", { name: /ru/ })
    expect(box).toHaveAttribute("aria-checked", "false")
    await user.click(box)
    expect(box).toHaveAttribute("aria-checked", "true")
    await user.click(screen.getByText("ru"))
    expect(box).toHaveAttribute("aria-checked", "false")
  })
})
