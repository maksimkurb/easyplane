import { describe, expect, it } from "vitest"

import { queryRetryDelay, shouldRetryQuery } from "@/lib/query-retry"

describe("query retry policy", () => {
  it("gives up after three retries", () => {
    expect(shouldRetryQuery(0, new Error("boom"))).toBe(true)
    expect(shouldRetryQuery(2, new Error("boom"))).toBe(true)
    expect(shouldRetryQuery(3, new Error("boom"))).toBe(false)
  })

  it("does not retry client errors", () => {
    expect(shouldRetryQuery(0, { status: 404, message: "nope" })).toBe(false)
    expect(shouldRetryQuery(0, { status: 422, message: "nope" })).toBe(false)
  })

  it("respects a rate limit", () => {
    expect(shouldRetryQuery(0, { status: 429, message: "slow down" })).toBe(
      true
    )
  })

  it("backs off exponentially with a cap", () => {
    expect(queryRetryDelay(0)).toBe(1000)
    expect(queryRetryDelay(1)).toBe(2000)
    expect(queryRetryDelay(2)).toBe(4000)
    expect(queryRetryDelay(10)).toBe(8000)
  })
})
