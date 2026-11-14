import { afterEach, describe, expect, it, vi } from "vitest"

import { apiFetch } from "@/api/client"

function mockFetch(status = 200, body: unknown = { ok: true }) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  )
  vi.stubGlobal("fetch", spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("apiFetch", () => {
  it("sends the CSRF cookie as a header on mutating requests", async () => {
    document.cookie = "easyplane_csrf=csrf-value; path=/"
    const spy = mockFetch(200, { ok: true })
    await apiFetch("/api/networks", { method: "POST", body: JSON.stringify({ name: "x" }) })
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get("x-csrf-token")).toBe("csrf-value")
    expect(headers.get("content-type")).toBe("application/json")
    expect(init.credentials).toBe("same-origin")
  })

  it("does not send CSRF on GET", async () => {
    document.cookie = "easyplane_csrf=csrf-value; path=/"
    const spy = mockFetch(200, [])
    await apiFetch("/api/networks")
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get("x-csrf-token")).toBeNull()
  })

  it("wraps successful payloads in an orval envelope", async () => {
    mockFetch(200, { id: "n1" })
    const result = await apiFetch<{ data: unknown; status: number }>("/api/networks/n1")
    expect(result.status).toBe(200)
    expect(result.data).toEqual({ id: "n1" })
  })

  it("throws a structured ApiError", async () => {
    mockFetch(403, { error: "insufficient role", code: "forbidden" })
    await expect(apiFetch("/api/networks", { method: "POST" })).rejects.toMatchObject({
      status: 403,
      message: "insufficient role",
      code: "forbidden",
    })
  })

  it("notifies the app when the session expired", async () => {
    mockFetch(401, { error: "authentication required", code: "unauthenticated" })
    const listener = vi.fn()
    window.addEventListener("easyplane-auth-required", listener)
    await expect(apiFetch("/api/auth/me")).rejects.toMatchObject({ status: 401 })
    window.removeEventListener("easyplane-auth-required", listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
