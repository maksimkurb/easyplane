# Load test (M4)

`bun run test:load` starts the real control plane against a throwaway
PostgreSQL database and connects N **simulated** config-server clients. The
clients are not a mock protocol: they use the production tunnel framing, the
Noise handshake, AES-128-GCM epochs, RPC piece reassembly and register the real
`WebClientService` methods (`RunNetworkInstance`, `CollectNetworkInfo`,
`GetNetworkInstanceConfig`, ...). Every heartbeat, enrollment, approval,
config push and verification therefore takes the production code path.
`test/support/protocol-client.ts` is the client; it is also used by the Noise
rotation soak.

```bash
bun run test:load                                        # 200 clients, ws, Noise
EASYPLANE_LOAD_CLIENTS=500 bun run test:load
EASYPLANE_LOAD_TRANSPORT=udp EASYPLANE_LOAD_CLIENTS=200 bun run test:load
```

Environment: `EASYPLANE_LOAD_CLIENTS`, `EASYPLANE_LOAD_TRANSPORT`
(`ws`/`tcp`/`udp`), `EASYPLANE_LOAD_WARMUP_MS` (default 3000),
`EASYPLANE_LOAD_CONVERGE_TIMEOUT_MS` (default 180000),
`EASYPLANE_LOAD_POOL_SIZE` (default 20), `EASYPLANE_LOAD_LOG_LEVEL`.

The test measures: connect rate (clients that received a heartbeat reply),
enrollment time (devices visible in `pending`), approval time (N approvals
serialised per network), convergence (the desired-state engine records
`applied_revision` for every device), heartbeat round-trip latency at steady
state, process RSS before/after, server CPU time and DB row counts.

## Measured results

Host: Linux, Node 26.10 (the project targets Node 22+), PostgreSQL 17 in
Docker on the same machine, all traffic over loopback. Each row is a full
run: connect → enroll → approve → push → verify, then a 3 s steady-state
heartbeat sample.

| clients | transport | secure | connect | enroll | approve | converge | pushes | heartbeat p50 / p95 / p99 / max | failures | RSS delta | server CPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 200 | ws | Noise | 1.7 s (121/s) | 1.7 s | 5.9 s | 0.27 s | 200 | 12 / 63 / 301 / 579 ms | 0 | +32 MB (0.16/client) | 5.1 s |
| 300 | ws | Noise | 2.3 s (129/s) | 2.4 s | 11.4 s | 0.26 s | 300 | 67 / 169 / 586 / 1241 ms | 0 | +64 MB (0.21/client) | 9.8 s |
| 500 | ws | Noise | 4.2 s (119/s) | 4.4 s | 20.1 s | 0.27 s | 500 | 16 / 492 / 1691 / 1980 ms | 0 | +87 MB (0.17/client) | 20.4 s |
| 200 | udp | Noise | 1.7 s (115/s) | 1.7 s | 7.3 s | 0.26 s | 200 | 125 / 167 / 172 / 179 ms | 0 | −4 MB (flat) | 5.6 s |

Interpretation:

- Connection cost is dominated by the Noise X25519 handshake (~100–130
  clients/s on one loopback core). The per-client steady-state cost is about
  0.2 MB of RSS.
- A 500-client fleet keeps every heartbeat under 2 s at p99; the 5 s RPC
  timeout is the contract, so this leaves headroom for a few hundred devices
  per process.
- Approval is intentionally serialised **per network**: address and MagicDNS
  name allocation are read-then-write against unique indexes, and two
  concurrent approvals used to collide. Approval throughput is therefore
  ~25–35 devices/s regardless of client count.
- Convergence after approval is fast because a push is one
  `RunNetworkInstance` plus a `CollectNetworkInfo` poll; it does not wait for a
  reconcile tick.

## Bottlenecks found and fixed

1. **Invite row write amplification.** Every heartbeat updated
   `invites.last_used_at`, so a fleet of N devices serialised on one row and
   exhausted the pool. Fixed by touching it at most once a minute (it is
   telemetry, not state). This was the difference between "200 clients hang
   for minutes" and the numbers above.
2. **Per-heartbeat device writes.** Every heartbeat rewrote
   `devices.last_seen_at` and identity fields. Persistence is now coalesced
   (`EASYPLANE_HEARTBEAT_PERSIST_INTERVAL_MS`, default 2 s) with identity
   changes written immediately; live status and SSE still update per event.
   At 500 clients this removed the remaining heartbeat timeouts.
3. **Concurrent approvals.** Two approvers could allocate the same address or
   DNS name and fail on the unique index. Approvals are now queued per
   network inside the process (documented single-replica limitation).

## Not measured

- WAN/TLS behaviour (reverse proxy, real network latency, packet loss).
- Multiple replicas (not supported; see docs/DEPLOY.md §6).
- Real `easytier-core` at this scale: the conformance suite proves the wire
  protocol with real clients (including UDP), and the simulated clients reuse
  the same client-side protocol implementation. CPU for real endpoints also
  includes the data plane, which the config-server control plane does not run.
