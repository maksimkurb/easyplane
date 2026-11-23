/**
 * Per-device state machine:
 *   approval: pending | approved | blocked
 *   liveness: online | offline
 *   config:   not-applicable | in-sync | stale | error
 *
 * The three dimensions are independent; the UI renders them as three badges
 * and the API returns them structured. Unit-tested in test/unit/device-status.
 */

export type ApprovalState = "pending" | "approved" | "blocked";
export type OnlineState = "online" | "offline";
export type SyncState = "not-applicable" | "in-sync" | "stale" | "error";

export interface DeviceStatusInput {
  state: ApprovalState;
  lastSeenAt: Date | null;
  now: Date;
  onlineTimeoutMs: number;
  desiredRevision: number | null;
  appliedRevision: number | null;
  lastPushError: string | null;
  /**
   * The client keeps reporting a config that differs from the desired one even
   * after a push (see `domain/drift.ts`). The instance is running, so
   * `appliedRevision` looks current, but the device is not on the desired
   * config: "stale", not "in-sync".
   */
  driftPending?: boolean;
}

export interface DeviceStatus {
  state: ApprovalState;
  online: OnlineState;
  sync: SyncState;
  /** Stable machine-readable combination, e.g. "approved/online/in-sync". */
  label: string;
}

export function computeDeviceStatus(input: DeviceStatusInput): DeviceStatus {
  const online: OnlineState =
    input.state !== "blocked" &&
    input.lastSeenAt !== null &&
    input.now.getTime() - input.lastSeenAt.getTime() <= input.onlineTimeoutMs
      ? "online"
      : "offline";

  let sync: SyncState;
  if (input.state !== "approved") {
    // Pending devices deliberately receive no config; blocked devices are
    // refused, so neither can be in sync.
    sync = "not-applicable";
  } else if (input.lastPushError !== null && input.lastPushError !== "") {
    sync = "error";
  } else if (input.desiredRevision === null) {
    sync = "not-applicable";
  } else if (
    input.appliedRevision === null ||
    input.appliedRevision < input.desiredRevision ||
    input.driftPending === true
  ) {
    sync = "stale";
  } else {
    sync = "in-sync";
  }

  return {
    state: input.state,
    online,
    sync,
    label: `${input.state}/${online}/${sync}`,
  };
}
