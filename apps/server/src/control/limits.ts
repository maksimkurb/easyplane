/**
 * Bounded admission and liveness helpers for the config-server listeners.
 *
 * The listeners are internet-facing and unauthenticated until the first
 * heartbeat, so the control plane must cap:
 *  - how fast one source IP can open tunnels (SYN/upgrade flood),
 *  - how many tunnels exist at once (memory/file descriptors),
 *  - how long a tunnel may stay silent (half-open TCP, dead NAT, stalled TLS).
 */

/** Fixed-window per-key limiter with a bounded key table. */
export class AcceptRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limitPerMinute: number,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 20_000,
  ) {}

  /** Records one attempt; returns false when the caller must be refused. */
  allow(key: string, now = Date.now()): boolean {
    if (this.limitPerMinute <= 0) return true;
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      this.evict(now);
      return true;
    }
    current.count += 1;
    return current.count <= this.limitPerMinute;
  }

  private evict(now: number): void {
    if (this.windows.size <= this.maxKeys) return;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
    // Still too large (a real flood from many IPs): drop the oldest quarter.
    if (this.windows.size > this.maxKeys) {
      const excess = this.windows.size - this.maxKeys;
      let removed = 0;
      for (const key of this.windows.keys()) {
        this.windows.delete(key);
        removed += 1;
        if (removed >= excess) break;
      }
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

export interface LivenessClient {
  readonly id: string;
  readonly isClosed: boolean;
  readonly connectedAt: number;
  readonly lastHeartbeatAt: number | null;
  close(reason?: string): void;
}

/**
 * Returns clients whose last heartbeat (or connection, before the first
 * heartbeat) is older than `timeoutMs`. A real easytier-core sends one
 * heartbeat per second, so a silent tunnel is either half-open or dead.
 */
export function findSilentClients<T extends LivenessClient>(
  clients: readonly T[],
  now: number,
  timeoutMs: number,
): T[] {
  if (timeoutMs <= 0) return [];
  return clients.filter((client) => {
    if (client.isClosed) return false;
    const lastSeen = client.lastHeartbeatAt ?? client.connectedAt;
    return now - lastSeen > timeoutMs;
  });
}
