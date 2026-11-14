import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"

import { LoginPage } from "@/auth/login-page"
import { renderWithProviders } from "./test-utils"

function stubApi() {
  const responses: Record<string, unknown> = {
    "/api/auth/me": {
      error: "authentication required",
      code: "unauthenticated",
    },
    "/api/config": {
      orgName: "Acme",
      publicUrl: null,
      publicConfigServerUrl: "wss://vpn.example.com",
      bootstrapAvailable: true,
      providers: [
        { id: "keycloak", label: "Acme SSO", issuer: "https://idp.example.com" },
      ],
    },
  }
  const calls: string[] = []
  const fetchMock = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(responses).find((path) => url.endsWith(path))
    const body = key ? responses[key] : {}
    const status = key === "/api/auth/me" ? 401 : 200
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }
  globalThis.fetch = fetchMock as typeof fetch
  return calls
}

describe("LoginPage", () => {
  it("offers SSO buttons and never a password field", async () => {
    stubApi()
    renderWithProviders(<LoginPage />)

    expect(
      await screen.findByRole("button", { name: /Continue with Acme SSO/i })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Enter the administrator password/i)).not.toBeInTheDocument()
  })

  it("shows the break-glass bootstrap form when the server enables it", async () => {
    stubApi()
    renderWithProviders(<LoginPage />)
    expect(await screen.findByText(/Break-glass bootstrap/i)).toBeInTheDocument()
  })
})
