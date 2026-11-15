# User stories

Roles: **Admin**, **Member** (manages own devices/invites), **Viewer** (read-only), **Operator** (deploys the server), **Device** (an unmodified easytier-core client). Milestone in brackets. "AC" = acceptance criteria.

## Protocol / device side (M0)
- **P1** As a Device, I connect with `--config-server wss://host/<token>` or `tcp://host:port/<token>` and the server accepts the tunnel. AC: real easytier-core connects in the conformance test (wss/ws, tcp; udp last).
- **P2** As a Device using secure mode, I complete the Noise handshake. AC: works, or the spike report states exactly what fails with options.
- **P3** As a Device, my Heartbeat/GetFeature calls are answered and I stay connected; after drops I reconnect (1 s retry) without server leaks.
- **P4** As the Server, I can call RunNetworkInstance / CollectNetworkInfo / ListNetworkInstance / GetNetworkInstanceConfig on a connected device and decode results; unknown fields are tolerated.
- **P5** As a Maintainer, I re-sync protos with `scripts/sync-protos.sh <ref>`; CI fails on drift; conformance tests show whether a new core still works.

## Sign-in & access (M1)
- **A1** As a user I sign in only via OIDC (PKCE); groups/claims map to admin/member/viewer. AC: no password fields anywhere.
- **A2** As an Operator I configure several providers via env/admin config.
- **A3** As an Operator I bootstrap the first admin with a break-glass env token, which stops working after an admin exists unless re-enabled.
- **A4** As anyone, every API endpoint enforces role server-side; state-changing requests need CSRF protection; sessions live in PostgreSQL.

## Networks (M1, M4)
- **N1** As an Admin I create a network (name, server-generated EasyTier network_name + secret, IP allocation range/strategy, defaults).
- **N2** As an Admin I import a network from pasted/uploaded TOML, a `comp_cfg?cfg=` share link, or by adopting a connected device's running config; a diff/preview is shown before saving and the secret is preserved. (M4)
- **N3** As an Admin I see each network's desired config with revision history (who/when) and can roll back to a revision.

## Join & approval (M1)
- **J1** As an Admin/Member I create an invite (single-use or reusable, expiry, optional pre-assigned tags). The panel shows a QR code, a copyable `easytier-core --config-server wss://<host>/<invite-token> …` command, and the plain URL for the Android app.
- **J2** As a Device joining via an invite, I appear as PENDING (machine_id, hostname, OS/version, source IP, invite used) and receive no config and run nothing until approved.
- **J3** As an Admin I approve, block, or delete devices; blocked devices are disconnected/refused.
- **J4** As the Operator, unknown tokens are rejected with rate limiting and caps so anonymous clients cannot fill the DB.
- **J5** Invite tokens are stored hashed and shown only once.

## Desired state & status (M1, M3)
- **D1** As an Admin I edit a device's desired config; the server pushes on connect and on every change, idempotently, tracking applied revision and error (desired vs applied).
- **D2** As a user I see per-device state: pending/approved/blocked × online/offline × in-sync/stale/error, last seen, client version, OS, public/virtual IPs, NAT type. Incompatible client versions show a warning, not a crash.
- **D3** As a user, the browser updates live over SSE without refresh, with reconnect/backoff and a resync after a server restart.
- **D4** As an Admin I see an audit log of approvals, policy changes, invites, config pushes (no secrets).

## Policy (M2, implemented — see docs/POLICY.md for the exact mapping)
- **Q1** As an Admin I define tags (`tag:server`) and a policy (UI + JSON/HuJSON advanced editor) with validation.
- **Q2** As an Admin I test "can A reach B on port P" before saving.
- **Q3** The policy compiles to EasyTier ACL primitives (chains, rules, groups with secrets, credentials) and the compiled per-device config is pushed. Docs list what maps cleanly, what is approximated, what is unsupported. Golden tests cover the compiler.
- **Q4** A denied flow is actually blocked on real clients (e2e).

## MagicDNS (M2, implemented; the DNS zone is a client-side flag)
- **M1** As an Admin I enable/disable MagicDNS per network and set the zone; hostnames are unique per network, renameable; resolved names/IPs are shown; a client resolves a name (e2e).

## Routes (M2, implemented; revocation limits are documented)
- **R1** As a Device owner/Admin I request subnet routes / exit node; they stay pending until approved; only approved routes are pushed.
- **R2** As an Admin I see routes devices actually report (CollectNetworkInfo) that are unapproved, flagged, with an honest note on what can/cannot be revoked remotely (e.g. file-configured instances are read-only).

## Topology (M3, implemented — see docs/REALTIME.md for the exact mapping and limits)
- **T1** As a user I see a live graph: devices as nodes, links as edges (direct vs relayed, relay node, protocol, latency, loss, cost). Polling is adaptive (faster only while someone watches), configurable, bounded.
- **T2** I open a device drawer with raw peer/route/connection info.
- **T3** The docs and UI make clear at least one node must be reachable for relay/NAT traversal, and the panel highlights it.

## Operations (M4)
- **O1** Operator runs everything with `docker compose up`; reverse-proxy example for wss; OIDC setup examples in docs.
- **O2** Structured logs, `/health`, optional Prometheus metrics; secrets never logged.
- **O3** Load test with a few hundred simulated clients.
- **O4** EN and RU UI from day one.
- **O5** CI (GitHub Actions) runs lint, typecheck, unit tests, docker conformance suite.
