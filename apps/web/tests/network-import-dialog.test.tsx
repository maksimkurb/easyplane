import { afterEach, describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"

import i18n from "@/i18n"
import { NetworkImportDialog } from "@/components/network-import-dialog"
import { renderWithProviders } from "./test-utils"

function stubApi() {
  const fetchMock = async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/api/auth/me")) {
      return new Response(
        JSON.stringify({ error: "authentication required", code: "unauthenticated" }),
        { status: 401, headers: { "content-type": "application/json" } }
      )
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  globalThis.fetch = fetchMock as typeof fetch
}

describe("NetworkImportDialog", () => {
  afterEach(async () => {
    localStorage.removeItem("easyplane-language")
    await i18n.changeLanguage("en")
  })

  it("offers TOML, share link and device sources without any secret field", () => {
    stubApi()
    renderWithProviders(<NetworkImportDialog onOpenChange={() => {}} open />)

    expect(screen.getByText("Import a network")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /TOML config/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Share link/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /From a device/i })).toBeInTheDocument()
    expect(screen.getByLabelText("EasyTier TOML")).toBeInTheDocument()
    expect(screen.getByText(/never sent to this browser/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/network secret/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Preview import/i })).toBeDisabled()
  })

  it("is translated into Russian", async () => {
    stubApi()
    localStorage.setItem("easyplane-language", "ru")
    renderWithProviders(<NetworkImportDialog onOpenChange={() => {}} open />)
    expect(screen.getByText("Импорт сети")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /TOML-конфигурация/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Предпросмотр импорта/i })).toBeDisabled()
  })
})
