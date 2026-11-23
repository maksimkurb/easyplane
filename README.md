# EasyPlane

Control plane for [EasyTier](https://github.com/EasyTier/EasyTier): a config
server + web panel that speaks the **real EasyTier wire protocol**, so
unmodified `easytier-core` clients (`--config-server`, Android JNI) can connect
and be managed. It is not a fork of `easytier-web`; only the wire protocol is
kept compatible.

Status: **M0–M4 complete**. Real `easytier-core 2.6.4-81487c36` clients (built
from the pinned upstream commit) join through invites over `ws`/`wss`/`tcp`/
`udp`, complete the Noise handshake, receive config after approval, track
desired vs applied revisions, reconnect, go offline/online and are refused when
blocked. A versioned access policy (rules, device tags, user groups, named
subnets) compiled to EasyTier ACLs, MagicDNS names and subnet/exit-node
approvals are managed from the panel; the browser
updates live over SSE and a connectivity map shows direct vs relayed paths.
M4 adds network import (TOML, share link, live device), hardening, optional
Prometheus metrics, the UDP session layer, and a load test with hundreds of
simulated clients. A network can additionally authenticate devices with
per-device credentials instead of one shared secret (mode B); see
[docs/CREDENTIALS.md](docs/CREDENTIALS.md). An optional **bundled rendezvous node** (a stock
`easytier-core` public node, no data relay by default) is shipped as a compose
profile for networks that cannot reach a hub directly.

- [docs/PROTOCOL.md](docs/PROTOCOL.md) — wire protocol, control semantics, UDP layer, import formats
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — tested versions, supported range, re-syncing protos
- [docs/DEPLOY.md](docs/DEPLOY.md) — compose, nginx/Caddy wss, OIDC (Keycloak/Authentik/Google), metrics
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — load-test method and measured numbers
- [docs/REALTIME.md](docs/REALTIME.md) — SSE design, topology collection, the map
- [docs/POLICY.md](docs/POLICY.md) — policy model v2, compiler translation, measured EasyTier ACL behaviour, honest limits
- [docs/CREDENTIALS.md](docs/CREDENTIALS.md) — per-device credentials: anchors, members, revocation, the no-anchor window
- [docs/BRIEF.md](docs/BRIEF.md), [docs/USER_STORIES.md](docs/USER_STORIES.md)

## Architecture

```
                    ┌──────────────────────────────────────────────┐
 browser ──https──▶ │ Fastify (Node 22+)                            │
   (SSE, orval)     │  /api  session + CSRF + roles + rate limits   │
                    │  /metrics (optional, token/internal)          │
                    │                                              │
                    │  control plane                                │
                    │   ws/wss :22023   tcp :22020   udp :22021     │
                    │   EasyTier framing → Noise → RPC session      │
                    │   WebServerService  ◀── heartbeats            │
                    │   WebClientService  ──▶ config/push/collect   │
                    │                                              │
                    │  desired state   policy   topology   SSE hub  │
                    └───────────────┬──────────────────────────────┘
                                    │ Drizzle
                              PostgreSQL 17
```

| path | contents |
| --- | --- |
| `apps/server` | Fastify API, Drizzle/PostgreSQL, OIDC, desired-state engine, EasyTier tunnel/RPC/WebServerService, policy compiler, MagicDNS/routes, SSE hub, topology collector, import service, metrics |
| `apps/web` | React 19 + Vite + Tailwind 4 + shadcn/base-ui panel (en/ru), `@xyflow/react` map |
| `packages/proto` | generated ts-proto bindings for the pinned upstream protos |
| `packages/shared` | UUID ↔ protobuf helpers |
| `proto/easytier` | verbatim copy of `easytier-proto/proto` at the pinned commit |
| `apps/server/drizzle` | SQL migrations (drizzle-kit) |
| `test/conformance` | vitest driving real `easytier-core` containers |
| `test/integration` | vitest against real PostgreSQL + a mock OIDC provider |
| `test/support` | test app/database/OIDC helpers and the simulated protocol client |
| `scripts` | load test, proto sync/check, pinned test-client build |
| `docker` | server image and the conformance client image |

### Protocol notes (short version)

The full reference, with every claim labelled `[verified]` or `[source]`, is
[docs/PROTOCOL.md](docs/PROTOCOL.md). The essentials:

- The invite token is the last config-server URL path segment; for `tcp`/`udp`
  the client clears the path and sends the token in
  `HeartbeatRequest.user_token`.
- TCP: `u32 LE length` + tunnel payload. WebSocket: one binary message per
  tunnel payload. UDP: an 8-byte `conn_id/msg/len` session header with
  SYN/SACK, then DATA carrying one tunnel payload (M4).
- A tunnel payload starts with EasyTier's 16-byte peer-manager header and then
  an RPC packet (8 = request, 9 = response).
- Web-secure is `Noise_NN_25519_ChaChaPoly_SHA256` with prologue
  `easytier-webclient-noise-v1`; msg2 carries a 32-byte root key that derives
  AES-128-GCM traffic keys per `(epoch, direction)`. Epochs rotate after 1M
  packets or 10 minutes.
- Method indexes are 1-based. The server registers only `Heartbeat` and
  `GetFeature`; it calls `ValidateConfig`, `RunNetworkInstance`,
  `RetainNetworkInstance`, `CollectNetworkInfo`, `ListNetworkInstance`,
  `DeleteNetworkInstance`, `GetNetworkInstanceConfig` and
  `ListNetworkInstanceMeta` on the client.
- RPC bodies are split into pieces for a ~1248-byte UDP budget; the control
  plane reassembles by `(is_request, from_peer, transaction_id)`.

## Quick start (Docker)

```bash
cp .env.example .env     # set POSTGRES_PASSWORD, EASYPLANE_ENCRYPTION_KEY,
                         # EASYPLANE_BOOTSTRAP_ADMIN_TOKEN, public URLs, OIDC
docker compose up -d --build
```

To run a published release instead of building from source, use
`docker compose -f docker-compose.ghcr.yml up -d` (tags, `EASYPLANE_IMAGE_TAG`,
release procedure and package visibility: [docs/DEPLOY.md](docs/DEPLOY.md) §1b).

The optional public rendezvous node (devices find each other; no data relay by
default) is an opt-in profile:

```bash
docker compose --profile rendezvous up -d --build
# or standalone on a VPS: docker compose -f docker-compose.rendezvous.yml up -d
```

See [docs/DEPLOY.md](docs/DEPLOY.md) §4e for ports, `RENDEZVOUS_*` variables,
the shared-secret model and the CGNAT relay switch.

Open `http://localhost:8080`, bootstrap the first admin with the token, then
sign in through OIDC. TLS, reverse proxies (nginx + Caddy), IdP examples and
the optional UDP port are covered in [docs/DEPLOY.md](docs/DEPLOY.md).

## Development

Requires Node 22+, [Bun](https://bun.sh) (workspace install only — the runtime
is Node), `protoc` for binding regeneration, Docker for the integration and
conformance suites, and PostgreSQL for local runs.

```bash
bun install
bun run typecheck
bun run test:unit
bun run test:integration      # starts a throwaway Postgres container
bun run test:web

# Server + built UI:
bun run build && bun run web:build
EASYPLANE_DATABASE_URL=postgres://easyplane:easyplane@127.0.0.1:5432/easyplane \
EASYPLANE_ENCRYPTION_KEY=$(openssl rand -base64 32) \
EASYPLANE_BOOTSTRAP_ADMIN_TOKEN=dev-token \
bun run dev

# UI hot reload (proxies /api to 127.0.0.1:8080):
bun run web:dev
```

Schema changes:

```bash
bun run db:generate     # drizzle-kit generate (commit apps/server/drizzle)
bun run db:migrate      # apply manually; the server also migrates on startup
bun run openapi:generate
bun run --cwd apps/web api:generate
```

### Adding an OIDC provider

1. Register the redirect URI `https://<panel-host>/api/auth/callback/<id>` at
   the IdP (authorization code + PKCE; public clients without a secret work).
2. Append an entry to `EASYPLANE_OIDC_PROVIDERS` (JSON array):

```json
{
  "id": "keycloak",
  "label": "Company SSO",
  "issuer": "https://sso.example.com/realms/main",
  "clientId": "easyplane",
  "clientSecret": "...",
  "scopes": "openid email profile",
  "roleClaim": "groups",
  "adminGroups": ["easyplane-admins"],
  "memberGroups": ["easyplane-members"],
  "defaultRole": "viewer",
  "allowedEmailDomains": ["example.com"]
}
```

3. Restart the server. The login page lists every configured provider; users
   are keyed by `(issuer, subject)`, groups are mapped on every login, and the
   first admin comes from the break-glass token (disabled afterwards unless
   `EASYPLANE_BOOTSTRAP_REENABLE=true`).

Concrete Keycloak, Authentik and Google Workspace examples are in
[docs/DEPLOY.md](docs/DEPLOY.md) §3.

## Roles

| action | viewer | member | admin |
| --- | --- | --- | --- |
| read networks, devices, invites, policy, DNS, routes | ✅ | ✅ | ✅ |
| read audit log, reveal/rotate secrets, export/import networks | — | — | ✅ |
| create/revoke invites, approve/block/delete devices, edit desired config, set advertised endpoints | — | ✅ | ✅ |
| create/delete networks, edit policy, approve routes, create tags, toggle MagicDNS, edit the peer list, mark a device as hub | — | — | ✅ |
| switch authentication mode, change a device role, revoke/renew a member credential, rotate a network secret, remove an anchor (acknowledged) | — | — | ✅ |

All checks are server-side pre-handlers; the UI only hides controls. State
changing requests need the session-bound CSRF token from the `easyplane_csrf`
cookie in `x-csrf-token`. Unknown routes do not inherit the public-route
bypass; `returnTo` is restricted to same-origin paths.

## Importing networks (M4)

**Networks → Import network** (a dedicated page at `/networks/import`)
accepts:

- **EasyTier TOML** (paste or upload) — the same file `easytier-core -c` reads;
- **share link** — `https://…/comp_cfg?cfg=…` from the EasyTier GUI;
- **a connected device** — read via `GetNetworkInstanceConfig`.

Every source is parsed into the same normalised `NetworkConfig`, shown with a
diff and a list of fields EasyPlane will not import, then saved only after
confirmation. The **network secret is preserved byte-for-byte** and is never
sent to the browser during preview: the preview is stored server-side in a
short-lived draft. `peer_urls`/`[[peer]]` entries are kept as **raw peer
entries** (pushable exactly as before) and shown in the preview; when adopting
from a device, a raw URL that exactly equals another device's advertised
endpoint is proposed for linking, which converts it into a device-backed entry
and stops that device from dialling itself. Credential-mode networks (a private
key with no shared secret) are refused instead of being broken silently, and
the error explains how to add the device as a member of a credentials network
instead. The
reverse direction is available as an audited admin export
(`?format=toml|share-link`). Formats, field mapping and golden tests are
described in [docs/PROTOCOL.md](docs/PROTOCOL.md) §13.2.

## Access policy, MagicDNS and routes

- A **policy document v2** per network (HuJSON accepted, three modes: `open`
  with no ACL pushed, `rules`, or `json` editing the same document) with
  device **tags** and **user groups** as separate concepts, named **subnets**
  (approved routes, usable as source and destination so a host behind a router
  `subnet:home-lan` is addressable), device/host/CIDR subjects, protocol and
  port/range lists, source ports, allow/deny order, per-chain defaults and
  names, stateful/rate-limit controls, and optional strict group proofs. v1
  documents still load and are upgraded on save. It is validated, versioned
  append-only, previewable ("can A reach B on port P", including a raw source
  IP and the deciding chain) and compiled **per device** into EasyTier's
  inbound/outbound/forward chains, including the egress and reply rules that
  make an allow work with default-drop chains. The compiled ACL is inspectable
  per device and referenced by a `policy_version` on each config revision, so
  it is audited and rollbackable.
- **MagicDNS** is a per-network switch with a zone and unique, renameable DNS
  names per network (enforced in the API and by a DB index).
- **WireGuard portal**: a hub can serve ordinary WireGuard clients (phones,
  routers, devices that cannot run EasyTier). They are managed in the panel as
  a separate kind with their own badge, get a virtual IP from the same pool as
  devices, carry tags so the same policy applies, report live
  connected/not-connected state, and the admin can show a QR code or download
  the `.conf` (fetched on demand from the hub, admin-only, never cached). See
  [docs/PROTOCOL.md](docs/PROTOCOL.md) §16 and
  [docs/DEPLOY.md](docs/DEPLOY.md) §4d-2.
- **Subnet/exit-node routes** are requested by members or **declared by the
  device itself** (Tailscale-style: stop the client, add `[[proxy_network]]` /
  `enable_exit_node` to its persisted config, start it) and approved by admins.
  Only approved routes reach `proxy_cidrs`; every receiver gets an explicit
  `enable_manual_routes` list, so an unapproved advertisement is never installed
  on another member. The panel reports what clients actually advertise,
  including routes it did not approve, and keeps declared proposals with a
  "no longer advertised" flag instead of forgetting them. Exit-node approval is
  consent only: egress also needs the client's OS route and its own `exit_nodes`
  setting (docs/DEPLOY.md §4b has the OpenWrt recipes).
- [docs/POLICY.md](docs/POLICY.md) lists exactly which Tailscale constructs map
  cleanly, which are approximated and which are unsupported — including the
  EasyTier limits that no control plane can work around.

## Device authentication: shared secret or credentials

A network authenticates devices in one of two ways (admin, **Device
authentication** on the network page; full design and honest limits in
[docs/CREDENTIALS.md](docs/CREDENTIALS.md)):

- **Shared secret (default):** every device knows the network secret. Simple,
  no dependencies; removing a device does not take the secret back and one leak
  exposes the whole network.
- **Per-device credentials:** **anchors** (always-on nodes, e.g. a server/VPS)
  hold the secret and publish the trusted credential list over OSPF; **members**
  join with their own X25519 credential and never see the secret, so access is
  revocable per device, has a TTL and can carry EasyTier ACL groups. The panel
  issues credentials with `node:crypto`, stores them AES-256-GCM at rest,
  pushes them to anchors, renews them before expiry and revokes them on demand.

The first device of a credentials network must be an anchor. At least one anchor
must be **online** for new members to connect through a rendezvous node: the
node learns the network and its trusted keys from a secret-verified anchor. The
network card warns at zero and at one anchor. Anchors are permanent secret
holders — removing one is only cosmetic until the secret is rotated, so the UI
blocks that removal behind an explained acknowledgement and a guided rotation.
Switching modes is a dry-run-guided migration; the reverse direction is
explained as the largest blast radius. Credential-mode configs are still refused
on import (the key is a device identity, not a network).

Verified with the real pinned client: a member joins an anchor directly and
through the rendezvous node, a revoke cuts a reconnecting member immediately
and a live relayed session within ~2 minutes, expiry drops live peers at the
timestamp, and with every anchor offline a new member is refused by the node
and recovers automatically when an anchor returns. Credential changes restart
the anchor instance for a moment because the config-server channel cannot patch
`managed_credentials` in place.

## Hub peers and self-dialling

EasyTier forms a mesh from the `peer_urls` in each instance's config. A list
that is broadcast unchanged to every device eventually contains a device's own
public URL: that node dials itself through its public address and the core
loops with `peer id conflict, are you connecting to yourself?`.

EasyPlane never compares hostnames or IPs to avoid this. Each device can
advertise extra **endpoints** (DDNS names or other transports, e.g.
`wss://h-1.example.com:443`) and be marked **hub**. A hub also listens on its
**listen port** (default 11010, tcp+udp) and the panel detects its public IPv4
automatically, advertising `tcp://<public IP>:<external port>` (the external
port falls back to the listen port). A network has one ordered peer list of
device-backed entries and raw external URLs; at push time the compiler builds
the list per device:

- the automatic public endpoint and every extra endpoint of an **approved
  hub** except the target device, identified by `device_id` (and re-checked by
  `machine_id`);
- every **raw** URL, unless it is explicitly linked to the target device;
- de-duplicated by URL and in a stable order.

A device that is the only hub therefore receives an empty list — it is the
listener. Members can edit a device's extra endpoints; admins add/remove peer
entries, link a raw URL to its device and toggle the hub flag. Links are exact
string matches against advertised endpoints, never DNS or IP guesses. Endpoint
or port changes are audited, broadcast over SSE and repush the devices that dial
the hub, without creating a revision: the peer list is network state compiled at
push time, like routes and MagicDNS.

## Bundled rendezvous node

A network with no reachable hub leaves devices with nothing to dial. The
optional `rendezvous` compose profile runs a **stock `easytier-core` public
node** whose only job is discovery: initial contact, peer RPC/OSPF and NAT
hole-punch coordination. It **does not forward user data** unless
`RENDEZVOUS_RELAY_DATA=true`, the fallback for symmetric NAT/CGNAT users who
cannot get a direct path. It needs no TUN device or capabilities.

It is protected by a shared secret rather than being open: private mode (the
default) admits a foreign network only when it can prove the node's
`RENDEZVOUS_NETWORK_SECRET`; networks keep their own names and stay isolated,
but one node has one secret. The panel can verify/align that secret
(`EASYPLANE_RENDEZVOUS_SECRET`), shows a read-only card with endpoints and
relay/private state, and an admin per-network **Use bundled rendezvous node**
toggle appends the endpoints to every device's peer list (audited, SSE,
repush; compile-time state, like hubs). Enabling it also pushes
`secure_mode: { enabled: true }`, because the secret proof only exists in
EasyTier secure mode. An advanced per-network `p2p_only` toggle forbids relay
fallback; the UI warns that some NAT combinations then cannot connect.

The source-level proof (private mode, `disable_relay_data`,
`relay_network_whitelist`, `relay_all_peer_rpc`, `p2p_only`, secure mode) is in
[docs/PROTOCOL.md](docs/PROTOCOL.md) §14; hosting, ports, threat model and the
VPS compose file are in [docs/DEPLOY.md](docs/DEPLOY.md) §4e. Version choice and
its honest limits are in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Realtime and the topology map (M3)

- The panel subscribes to `GET /api/events` (server-sent events). The stream is
  authenticated by the same session cookie as the API, role-checked server-side,
  bounded per user (`EASYPLANE_SSE_MAX_PER_USER`) and replayed by
  `Last-Event-ID`; a reconnect the server cannot replay triggers a full cache
  resync. Events cover device online/offline, last seen, approval state,
  applied revision/error, policy/route/network changes and topology updates.
  [docs/REALTIME.md](docs/REALTIME.md) §1 explains why SSE and not WebSocket.
- **Topology** is collected with `CollectNetworkInfo` per online device. It is
  adaptive (30 s idle, 5 s while a map is open, ±20 % jitter, 4 parallel probes
  by default), keeps one bounded snapshot per network and marks cycles with
  failed probes as `partial`. The map is `@xyflow/react` with a deterministic
  radial layout; direct edges are solid, relayed edges dashed and named with
  the relay and first-hop protocol. At least one reachable node matters, and the
  map separates `reachable` from demonstrably `relayCapable`.

## Hardening and observability (M4)

- Config-server admission: per-IP rate limit, connection cap, heartbeat reaper
  for half-open sessions, UDP session cap/idle sweep, 1 MiB frame limit, piece
  reassembly bounds. All configurable; see `.env.example`.
- API: global per-IP limit plus stricter per-route limits on auth, import,
  secret reveal/rotate, export and invite creation. Structured 429 responses.
- Secret hygiene: EasyTier secrets are AES-256-GCM at rest, never in revision
  rows, audit metadata, logs or import previews; invite tokens are stored only
  as SHA-256; ACL group secrets are derived from the master key and never
  stored. Unit tests scan audit sanitisation and every logger call.
- Optional Prometheus `/metrics`: bearer-token authenticated on the app, or an
  internal-only listener (`EASYPLANE_METRICS_PORT`), disabled by default. See
  [docs/DEPLOY.md](docs/DEPLOY.md) §5.
- `GET /health` reports DB and client counts.
- **One replica only.** Session registry, SSE hub, topology snapshots, rate
  limiters, import drafts and the reconcile timer are in-process. The database
  is shared and safe, but a second replica cannot push to clients connected to
  the first and would duplicate work. [docs/DEPLOY.md](docs/DEPLOY.md) §6 is the
  honest list.

### Load and key rotation

`bun run test:load` runs a few hundred simulated clients over the production
tunnel/Noise/RPC code and reports connect rate, memory, heartbeat latency and
reconcile load. Measured on loopback (200/300/500 clients, ws + Noise and 200
over UDP) with p99 heartbeat latency under 2 s at 500 clients, ~0.2 MB RSS per
client and zero heartbeat failures; the two bottlenecks found (invite row
write amplification, per-heartbeat device writes) are fixed.
[docs/PERFORMANCE.md](docs/PERFORMANCE.md) has the numbers and what they do not
cover. The unit suite also soaks the web-secure epoch rotation: 40k packets in
both directions across 40 epochs, replay rejection and clock-driven rotation.

## EasyTier compatibility

Everything EasyTier-specific was derived from the pinned upstream commit
`81487c363a56779e745eae927e130a813535c71e` (client version string
`2.6.4-81487c36`). Conformance runs against a real client built from that
commit, not the official `v2.6.4` tag (a different commit). Supported range,
tested transport matrix and the re-sync procedure are in
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Protobuf sync

```bash
scripts/sync-protos.sh 81487c363a56779e745eae927e130a813535c71e
scripts/check-protos.sh          # CI: fails on drift
```

Only `easytier-proto/proto/*.proto` is copied upstream; the commit and source
path are recorded in `proto/easytier/UPSTREAM_REF`.

## Tests

```bash
bun run typecheck            # server + test sources + web
bun run lint                 # web eslint
bun run test:unit            # domain rules, crypto, protocol, policy, import goldens
bun run test:integration     # Postgres + mock OIDC: auth, CSRF, roles, API, imports, metrics
bun run test:web             # vitest + testing-library (import page, dialogs, en/ru)
bun run test:load            # simulated 200 clients (see docs/PERFORMANCE.md)

scripts/build-test-client.sh # real easytier-core from the pinned commit
docker compose -f docker-compose.test.yml --profile test build
bun run test:conformance     # real clients over ws/wss/tcp/udp + M1/M2/M3/M4 flows
```

The conformance suite proves, with real clients: credential mode (member joins
through the rendezvous node, revoke, the no-anchor window and recovery);
invite → pending → approve →
config running → revision change → rollback → offline/online → block; ACL
enforcement (200 on an allowed port, timeout on a denied one, both directions);
MagicDNS resolution; approved vs unapproved subnet routes; the M3 hub-and-spoke
relay map and the SSE stream; the M4 UDP session layer and adoption of a
running instance; a hub whose own endpoint is in the network peer list —
the real core's log has no `peer id conflict` while a leaf connects; and the
bundled rendezvous node — direct traffic with relay off, no data across
disjoint networks, relayed traffic plus `cost>1`/`next_hop` route data with
relay on, private-mode rejection of a wrong secret, and whitelist
admission/relay. Linux-only; set `EASYPLANE_CONFORMANCE_NO_TUN=1` when TUN is
unavailable.

CI (`.github/workflows/ci.yml`) runs proto drift, typecheck/lint/unit/web build,
integration (PostgreSQL service), the dockerised real-client conformance suite
and a server image build. A push to `main` that passes every gate additionally
publishes `edge` and `sha-<short>` images to `ghcr.io`
(`.github/workflows/_image.yml`, multi-arch `linux/amd64`/`linux/arm64`); pull
requests only build. Releases are cut with the manual `release` workflow, which
tags `vX.Y.Z`, publishes a GitHub release and pushes the versioned image — see
[docs/DEPLOY.md](docs/DEPLOY.md) §1b. A `v*` tag push publishes the image for
that tag without re-tagging. A manual `workflow_dispatch` load job runs the
simulated load test.
