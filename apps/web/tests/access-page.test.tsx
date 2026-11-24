import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { NetworkAccessPage } from "@/pages/network-access-page"
import { renderWithProviders } from "./test-utils"
import {
  DOCUMENT,
  NETWORK_ID,
  POLICY,
  SUBJECTS,
  USER,
  VERSIONS,
} from "./access-fixtures"
import { makeDevice, makeNetwork } from "./network-devices-page.fixtures"

const NETWORK = makeNetwork({
  id: NETWORK_ID,
  policyVersion: 3,
  policyMode: "rules",
})
const DEVICES = [
  makeDevice({
    id: "d-nas",
    hostname: "nas-01",
    dnsName: "nas-01",
    virtualIpv4: "10.144.144.5",
    tags: ["tag:home"],
  }),
  makeDevice({
    id: "d-vps",
    hostname: "vps-fra",
    dnsName: "vps-fra",
    virtualIpv4: "10.144.144.7",
    tags: ["tag:eu"],
  }),
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function stubApi(role: "admin" | "member" | "viewer") {
  let mode = "rules"
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? "GET").toUpperCase()
    if (url.endsWith("/api/auth/me")) {
      return jsonResponse({
        user: {
          ...USER,
          role,
        },
        organisation: { id: "org", name: "Home", slug: "home" },
        csrfToken: "csrf",
        providers: [],
      })
    }
    if (url.endsWith("/api/config")) {
      return jsonResponse({
        orgName: "Home",
        publicUrl: null,
        publicConfigServerUrl: null,
        bootstrapAvailable: false,
        providers: [],
      })
    }
    if (url.endsWith("/api/users")) return jsonResponse([USER])
    if (url.includes("/policy/mode") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { mode?: string }
      mode = body.mode ?? mode
      return jsonResponse({ version: 3, mode, revisionsCreated: 3 })
    }
    if (url.includes("/policy/subjects")) return jsonResponse(SUBJECTS)
    if (url.includes("/policy/versions")) return jsonResponse(VERSIONS)
    if (url.includes("/policy")) {
      return jsonResponse({ ...POLICY, mode, document: { ...DOCUMENT, mode } })
    }
    if (url.includes("/routes"))
      return jsonResponse({ routes: [], reports: [] })
    if (url.includes("/invites")) return jsonResponse([])
    if (url.startsWith("/api/devices")) return jsonResponse(DEVICES)
    if (url.endsWith(`/api/networks/${NETWORK_ID}`))
      return jsonResponse(NETWORK)
    if (url.includes("/tag")) return jsonResponse([])
    if (url.includes("/user-group")) return jsonResponse([])
    return jsonResponse([])
  }) as typeof fetch
}

describe("NetworkAccessPage", () => {
  it("shows the policy mode separately from the JSON editing view", async () => {
    stubApi("admin")
    const user = userEvent.setup({ document })
    renderWithProviders(<NetworkAccessPage networkId={NETWORK_ID} />)

    expect(await screen.findByText("Block SSH to NAS")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Rules" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(screen.getByRole("radio", { name: "Open" })).toHaveAttribute(
      "aria-checked",
      "false"
    )
    expect(
      screen.getByText(/Rules are checked top to bottom/)
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Tools" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit as JSON" })
    )
    const editor = await screen.findByRole("textbox", { name: "JSON / HuJSON" })
    expect((editor as HTMLTextAreaElement).value).toContain('"version": 2')
    expect((editor as HTMLTextAreaElement).value).toContain(
      '"Block SSH to NAS"'
    )
    await user.click(screen.getByRole("button", { name: "Back to rules" }))
    expect(await screen.findByTestId("rules-card")).toBeInTheDocument()
  })

  it("confirms switching the mode, with Cancel as the default", async () => {
    stubApi("admin")
    const user = userEvent.setup({ document })
    renderWithProviders(<NetworkAccessPage networkId={NETWORK_ID} />)

    expect(await screen.findByText("Block SSH to NAS")).toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: "Open" }))
    const dialog = screen.getByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("radio", { name: "Rules" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
  })

  it.each(["member", "viewer"] as const)(
    "is read-only for a %s",
    async (role) => {
      stubApi(role)
      renderWithProviders(<NetworkAccessPage networkId={NETWORK_ID} />)

      expect(await screen.findByText("Block SSH to NAS")).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole("radio", { name: "Rules" })).toBeDisabled()
      )
      expect(
        screen.queryByRole("button", { name: "Add rule" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Actions for Block SSH to NAS" })
      ).not.toBeInTheDocument()
      for (const toggle of screen.getAllByRole("switch")) {
        expect(toggle).toHaveAttribute("aria-disabled", "true")
      }
      expect(screen.getByTestId("rule-row-1")).toHaveAttribute(
        "data-disabled",
        "true"
      )
    }
  )
})
