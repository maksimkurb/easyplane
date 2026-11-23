import { manage } from "@easyplane/proto";

import { sha256Hex } from "../security/crypto.js";

/**
 * Config drift: the client keeps running an instance that does not match the
 * desired config even after a push. Some causes are permanent until the
 * device changes (an EasyTier build that cannot express a field, a client that
 * normalises something new), and repushing every reconcile tick only burns
 * load. This module keeps one drift record per device (inside
 * `devices.reported_state` so no migration is needed) and backs the retries
 * off exponentially while the desired fingerprint stays the same.
 */

/** First retry after drift was observed. */
export const DRIFT_BACKOFF_START_MS = 15_000;
/** Retries never get slower than this. */
export const DRIFT_BACKOFF_CAP_MS = 15 * 60_000;

/**
 * Delay before the next push after `attempt` consecutive pushes that did not
 * converge: 15 s → 30 s → 1 m → 2 m → 4 m → 8 m → 15 m (cap).
 *
 * `attempt` is 1-based and every value is clamped, so a corrupt persisted
 * counter can never produce `NaN`/`Infinity`.
 */
export function driftBackoffMs(attempt: number): number {
  const normalized = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  // 15 s doubling, capped: attempt 1 = 15 s, 7+ = 15 min.
  const raw = DRIFT_BACKOFF_START_MS * 2 ** Math.min(normalized - 1, 24);
  return Math.min(raw, DRIFT_BACKOFF_CAP_MS);
}

/** Sorted-key JSON so the fingerprint does not depend on property order. */
function canonicalJson(value: unknown): string {
  // protobuf-es configs carry `bigint` fields (expiry timestamps, bandwidth
  // limits, ...) which `JSON.stringify` refuses to serialise: a throw here
  // fails every push of such a device, so handle them (and `undefined`)
  // explicitly.
  if (typeof value === "bigint") return `"${value.toString()}n"`;
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value instanceof Uint8Array) {
    return JSON.stringify(Buffer.from(value).toString("base64"));
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/**
 * Hash of everything that decides the desired state. Used only to tell "the
 * same desired config is still not applied" from "the operator changed
 * something, retry immediately". The value may cover the network secret, so
 * only the hash is ever logged, and only truncated.
 */
export function desiredFingerprint(config: manage.NetworkConfig): string {
  return sha256Hex(canonicalJson(config));
}

/** Short form safe for logs: a drift reason never contains a secret anyway. */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}

export interface DriftState {
  /** Fingerprint of the desired config that failed to converge. */
  fingerprint: string;
  /** Human-readable mismatch reasons (never contains a secret). */
  reason: string;
  /** Consecutive pushes for this fingerprint that did not converge. */
  attempts: number;
  /** ISO timestamp of the last push attempt. */
  lastAttemptAt: string;
  /** ISO timestamp before which the panel will not push again. */
  nextRetryAt: string;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Reads the drift record persisted in `devices.reported_state`. */
export function readDriftState(reportedState: unknown): DriftState | null {
  if (!reportedState || typeof reportedState !== "object") return null;
  const raw = (reportedState as Record<string, unknown>).drift;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const lastAttemptAt = isoOrNull(value.lastAttemptAt);
  const nextRetryAt = isoOrNull(value.nextRetryAt);
  const reason = typeof value.reason === "string" ? value.reason : "";
  if (
    typeof value.fingerprint !== "string" ||
    value.fingerprint === "" ||
    lastAttemptAt === null ||
    nextRetryAt === null ||
    reason === ""
  ) {
    return null;
  }
  const attemptValue = typeof value.attempts === "number" ? value.attempts : 1;
  return {
    fingerprint: value.fingerprint,
    reason,
    attempts: Number.isFinite(attemptValue) ? Math.max(1, Math.floor(attemptValue)) : 1,
    lastAttemptAt,
    nextRetryAt,
  };
}

/**
 * Records a drift observation: same fingerprint continues the schedule,
 * a different desired config starts a fresh one (the operator changed
 * something, so the first retry is immediate-ish, never an old 15-minute
 * wait).
 */
export function nextDriftState(
  previous: DriftState | null,
  observation: { fingerprint: string; reason: string; now: Date },
): DriftState {
  const same = previous !== null && previous.fingerprint === observation.fingerprint;
  const attempts = same ? previous.attempts + 1 : 1;
  return {
    fingerprint: observation.fingerprint,
    reason: observation.reason,
    attempts,
    lastAttemptAt: observation.now.toISOString(),
    nextRetryAt: new Date(
      observation.now.getTime() + driftBackoffMs(attempts),
    ).toISOString(),
  };
}

/**
 * True while the same desired config is inside its backoff window. Used by the
 * reconcile loop to skip a redundant push; the caller still surfaces the drift
 * to the UI.
 */
export function shouldBackOff(
  state: DriftState | null,
  fingerprint: string,
  now: Date,
): boolean {
  if (!state || state.fingerprint !== fingerprint) return false;
  const nextRetry = Date.parse(state.nextRetryAt);
  if (!Number.isFinite(nextRetry)) return false;
  return now.getTime() < nextRetry;
}

/** Removes the drift record from `reported_state` (config converged/reset). */
export function withoutDriftState(
  reportedState: Record<string, unknown>,
): Record<string, unknown> {
  if (!("drift" in reportedState)) return reportedState;
  const { drift: _drift, ...rest } = reportedState;
  return rest;
}
