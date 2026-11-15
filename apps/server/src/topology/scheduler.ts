/**
 * Adaptive topology polling interval.
 *
 * The map is collected slowly when nobody watches it (it still feeds route
 * reports and the device drawer) and much faster while at least one browser has
 * the map open. Jitter avoids a fleet of panels synchronising their probes, and
 * the bounds keep a misconfiguration from turning into a load spike.
 */

export interface TopologyIntervalOptions {
  idleIntervalMs: number;
  activeIntervalMs: number;
  /** Fraction of the base interval added/subtracted, 0..0.9. */
  jitterRatio?: number;
  /** Absolute floor so `activeIntervalMs`/jitter can never hammer clients. */
  minimumIntervalMs?: number;
}

export const TOPOLOGY_DEFAULT_INTERVALS = {
  idleIntervalMs: 30_000,
  activeIntervalMs: 5_000,
  jitterRatio: 0.2,
  minimumIntervalMs: 1_000,
} as const;

/** Enforces `minimum <= active <= idle` and a sane jitter. */
export function normalizeTopologyIntervals(
  options: TopologyIntervalOptions,
): Required<TopologyIntervalOptions> {
  const minimum = Math.max(250, options.minimumIntervalMs ?? 1_000);
  const idle = Math.max(minimum, options.idleIntervalMs);
  const active = Math.min(idle, Math.max(minimum, options.activeIntervalMs));
  const jitter = Math.min(0.9, Math.max(0, options.jitterRatio ?? 0.2));
  return { idleIntervalMs: idle, activeIntervalMs: active, jitterRatio: jitter, minimumIntervalMs: minimum };
}

/**
 * Next delay in ms. `active` should be true only while a browser stream is
 * registered as a topology watcher.
 */
export function nextTopologyDelay(
  options: TopologyIntervalOptions & { active: boolean },
  random: () => number = Math.random,
): number {
  const normalized = normalizeTopologyIntervals(options);
  const base = options.active
    ? normalized.activeIntervalMs
    : normalized.idleIntervalMs;
  const spread = base * normalized.jitterRatio;
  // random() is in [0,1); centre the jitter on the base interval.
  const offset = (random() * 2 - 1) * spread;
  return Math.max(normalized.minimumIntervalMs, Math.round(base + offset));
}

/** Simple bounded-concurrency map used by the collector. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await task(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
