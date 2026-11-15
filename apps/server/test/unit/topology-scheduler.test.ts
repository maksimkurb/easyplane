import { describe, expect, it } from "vitest";

import {
  mapWithConcurrency,
  nextTopologyDelay,
  normalizeTopologyIntervals,
} from "@easyplane/server";

const base = { idleIntervalMs: 30_000, activeIntervalMs: 5_000, jitterRatio: 0.2 };

describe("adaptive topology interval", () => {
  it("uses the idle interval when nobody watches the map", () => {
    expect(nextTopologyDelay({ ...base, active: false }, () => 0.5)).toBe(30_000);
  });

  it("uses the active interval while a browser watches the map", () => {
    expect(nextTopologyDelay({ ...base, active: true }, () => 0.5)).toBe(5_000);
  });

  it("applies symmetric jitter around the base interval", () => {
    expect(nextTopologyDelay({ ...base, active: true }, () => 0)).toBe(4_000);
    expect(nextTopologyDelay({ ...base, active: true }, () => 1)).toBe(6_000);
  });

  it("never polls faster than the floor or slower than idle", () => {
    const aggressive = normalizeTopologyIntervals({
      idleIntervalMs: 1_000,
      activeIntervalMs: 100,
      jitterRatio: 0.9,
      minimumIntervalMs: 250,
    });
    expect(aggressive.activeIntervalMs).toBe(250);
    expect(aggressive.idleIntervalMs).toBe(1_000);
    for (let index = 0; index < 100; index += 1) {
      const delay = nextTopologyDelay(
        { ...aggressive, active: true },
        () => index / 100,
      );
      expect(delay).toBeGreaterThanOrEqual(250);
    }
  });

  it("clamps an active interval above the idle one", () => {
    const normalized = normalizeTopologyIntervals({
      idleIntervalMs: 5_000,
      activeIntervalMs: 60_000,
      jitterRatio: 0,
    });
    expect(normalized.activeIntervalMs).toBe(5_000);
    // Jitter is bounded to a usable range.
    expect(
      normalizeTopologyIntervals({
        idleIntervalMs: 10_000,
        activeIntervalMs: 5_000,
        jitterRatio: 4,
      }).jitterRatio,
    ).toBe(0.9);
  });

  it("applies jitter to the idle interval as well", () => {
    expect(nextTopologyDelay({ ...base, active: false }, () => 0)).toBe(24_000);
  });
});

describe("bounded concurrency helper", () => {
  it("keeps result order and never exceeds the limit", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency(
      Array.from({ length: 10 }, (_, index) => index),
      3,
      async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, item % 3));
        running -= 1;
        return item * 2;
      },
    );
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list and a zero limit", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 0, async (item) => item)).toEqual([1, 2]);
  });
});
