/**
 * Reconnect backoff for the browser event stream.
 *
 * `EventSource` retries on its own, but its fixed `retry:` delay cannot tell a
 * transient network blip from a server restart, so the panel drives its own
 * exponential backoff (with jitter) and only reopens the stream itself.
 */

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
}

export const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  baseMs: 1_000,
  maxMs: 30_000,
  jitterRatio: 0.2,
};

/**
 * Delay before reconnect attempt `attempt` (0-based). The delay doubles per
 * attempt up to `maxMs` and is spread by `jitterRatio` so many tabs do not
 * reconnect in lockstep after a server restart.
 */
export function nextBackoffDelay(
  attempt: number,
  options: BackoffOptions = {},
  random: () => number = Math.random,
): number {
  const { baseMs, maxMs, jitterRatio } = { ...DEFAULT_BACKOFF, ...options };
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const base = Math.min(maxMs, baseMs * 2 ** safeAttempt);
  const spread = base * Math.min(0.9, Math.max(0, jitterRatio));
  const offset = (random() * 2 - 1) * spread;
  return Math.max(250, Math.round(base + offset));
}
