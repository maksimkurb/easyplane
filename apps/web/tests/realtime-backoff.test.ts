import { describe, expect, it } from "vitest"

import { nextBackoffDelay } from "@/lib/realtime-backoff"

describe("SSE reconnect backoff", () => {
  it("doubles the delay per attempt", () => {
    expect(nextBackoffDelay(0, { jitterRatio: 0 })).toBe(1_000)
    expect(nextBackoffDelay(1, { jitterRatio: 0 })).toBe(2_000)
    expect(nextBackoffDelay(2, { jitterRatio: 0 })).toBe(4_000)
    expect(nextBackoffDelay(3, { jitterRatio: 0 })).toBe(8_000)
  })

  it("caps the delay at the maximum", () => {
    expect(nextBackoffDelay(20, { jitterRatio: 0 })).toBe(30_000)
    expect(nextBackoffDelay(100, { jitterRatio: 0 })).toBe(30_000)
    expect(nextBackoffDelay(4, { maxMs: 5_000, jitterRatio: 0 })).toBe(5_000)
  })

  it("applies symmetric jitter, never below the floor", () => {
    expect(nextBackoffDelay(0, { jitterRatio: 0.2 }, () => 0)).toBe(800)
    expect(nextBackoffDelay(0, { jitterRatio: 0.2 }, () => 1)).toBe(1_200)
    for (let index = 0; index < 100; index += 1) {
      const delay = nextBackoffDelay(index, {}, () => index / 100)
      expect(delay).toBeGreaterThanOrEqual(250)
      expect(delay).toBeLessThanOrEqual(30_000 * 1.2)
    }
  })

  it("treats negative attempts as the first retry", () => {
    expect(nextBackoffDelay(-5, { jitterRatio: 0 })).toBe(1_000)
  })
})
