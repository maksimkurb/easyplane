import { describe, expect, it } from "vitest"

import { findActiveNavHref, matchesNavHref } from "@/lib/nav-active"

const HREFS = ["/networks", "/networks/import", "/devices", "/devices/123"]

describe("matchesNavHref", () => {
  it("matches the exact path and its descendants", () => {
    expect(matchesNavHref("/networks", "/networks")).toBe(true)
    expect(matchesNavHref("/networks/123", "/networks")).toBe(true)
    expect(matchesNavHref("/networks-old", "/networks")).toBe(false)
  })
})

describe("findActiveNavHref", () => {
  it("prefers the most specific entry for a nested route", () => {
    expect(findActiveNavHref("/networks/import", HREFS)).toBe(
      "/networks/import"
    )
    expect(findActiveNavHref("/networks/123", HREFS)).toBe("/networks")
    expect(findActiveNavHref("/devices/123", HREFS)).toBe("/devices/123")
  })

  it("returns null when nothing matches", () => {
    expect(findActiveNavHref("/audit", HREFS)).toBeNull()
  })
})
