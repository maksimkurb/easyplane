/**
 * Retry policy shared by the queries in the device area.
 *
 * A failing background endpoint must not hammer the server: React Query's
 * default would retry twice in ~1s and 2s, and every realtime invalidation
 * would restart that loop. Three attempts with exponential backoff, no retry
 * for client errors and a hard cap keep the panel polite; the component shows
 * an inline error with a manual Retry once the budget is spent.
 */
export const MAX_QUERY_RETRIES = 3

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : Number.NaN
  // 4xx means the request itself is wrong; retrying cannot fix it. 429 is the
  // exception: the server asked us to slow down, so a backed-off retry is fine.
  if (
    Number.isFinite(status) &&
    status >= 400 &&
    status < 500 &&
    status !== 429
  ) {
    return false
  }
  return true
}

export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS)
}

/** Spread into a generated hook: `{ query: retryableQuery }`. */
export const retryableQuery = {
  retry: shouldRetryQuery,
  retryDelay: queryRetryDelay,
} as const
