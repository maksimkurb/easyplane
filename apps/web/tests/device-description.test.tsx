import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { DeviceDescriptionLine } from "@/components/device/device-description"
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

type Call = { url: string; init?: RequestInit }

function stubApi(calls: Call[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
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

describe("DeviceDescriptionLine", () => {
  it("offers a placeholder and saves the trimmed text on Enter", async () => {
    const calls: Call[] = []
    stubApi(calls)
    const user = userEvent.setup()
    renderWithProviders(
      <DeviceDescriptionLine
        canManage
        description={null}
        deviceId="d-owrt"
      />
    )

    expect(
      screen.getByText(
        "Add a description: where the device is and what it is for"
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Edit description" }))
    const field = await screen.findByRole("textbox")
    await user.type(field, "  Router in the garage  ")
    expect(screen.getByText(/^\d+ \/ 280$/)).toBeInTheDocument()
    await user.keyboard("{Enter}")

    const mutation = await waitFor(() => {
      const call = calls.find(
        (entry) => entry.init?.method === "PUT" && entry.url.includes("/description")
      )
      expect(call).toBeDefined()
      return call!
    })
    expect(mutation.url).toBe("/api/devices/d-owrt/description")
    expect(JSON.parse(String(mutation.init?.body))).toEqual({
      description: "Router in the garage",
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })

  it("shows a saved description without the placeholder", () => {
    stubApi([])
    renderWithProviders(
      <DeviceDescriptionLine
        canManage
        description="Телефон Макса"
        deviceId="d-pixel"
      />
    )
    expect(screen.getByText("Телефон Макса")).toHaveAttribute(
      "title",
      "Телефон Макса"
    )
    expect(
      screen.queryByText(
        "Add a description: where the device is and what it is for"
      )
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Edit description" })
    ).toBeInTheDocument()
  })

  it("shows nothing to a basic user when there is no description", () => {
    stubApi([])
    const { container } = renderWithProviders(
      <DeviceDescriptionLine
        canManage={false}
        description={null}
        deviceId="d-nas"
      />
    )
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByRole("button", { name: "Edit description" })
    ).not.toBeInTheDocument()
  })

  it("shows the text but no pencil to a basic user", () => {
    stubApi([])
    renderWithProviders(
      <DeviceDescriptionLine
        canManage={false}
        description="Дача, OpenWrt"
        deviceId="d-dacha"
      />
    )
    expect(screen.getByText("Дача, OpenWrt")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Edit description" })
    ).not.toBeInTheDocument()
  })
})
