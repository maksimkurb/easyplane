# Realtime updates and the topology map (M3)

This document explains how the browser learns about changes without polling,
how the connectivity map is collected from real `easytier-core` clients and
which parts of it are exercised against a real client (docker conformance) vs
derived by reading the pinned upstream sources.

Pinned reference: EasyTier commit
`81487c363a56779e745eae927e130a813535c71e` (client version `2.6.4-81487c36`).

Claims are labelled:

- **[verified]** — exercised against real `easytier-core 2.6.4-81487c36`
  containers in `test/conformance/m3.test.ts`.
- **[source]** — read from the pinned sources and covered by unit tests, but not
  exercised end-to-end.

## 1. Why SSE and not WebSocket

The panel only needs server → browser events. Every mutation is an ordinary
authenticated HTTP request with the CSRF token, so a bidirectional channel
would add a second way to make requests and a second place to enforce roles.

SSE was chosen because:

- **It works through any reverse proxy.** It is a plain HTTP response with
  `Content-Type: text/event-stream`; nginx/Caddy/Traefik need `proxy_buffering
  off` (or the `X-Accel-Buffering: no` header we send) but no `Upgrade`
  handling, no connection upgrade timeouts and no sticky sessions.
- **Authentication is the existing session cookie.** `EventSource` cannot set
  request headers, but it does send cookies for same-origin requests, so the
  endpoint reuses the same Fastify pre-handler (session lookup, cookies,
  organisation) as every other API route. A WebSocket would need a token in the
  URL or an origin/Сookie dance anyway.
- **Role checks are one function call.** `GET /api/events` runs the same
  `requireRole` pre-handler; viewers, members and admins may all read. There is
  no write path on the stream, so there is nothing to CSRF-protect.
- **The browser gives us reconnect signals for free** (`open`, `error` and the
  last event id), while the client applies its own exponential backoff.
- **No extra runtime dependency** on the server or in the browser bundle.

The trade-off: one connection per browser tab (the panel opens two only while
the map is open — see §5), and an event stream that a proxy can idle out. Both
are handled by a 15 s keep-alive comment and bounded reconnects.

`GET /api/events` is hidden from the OpenAPI document: a generated JSON client
cannot consume a stream. The contract is this document plus
`apps/server/src/realtime/events.ts` (shared shape) and
`apps/web/src/realtime/*` (client).

## 2. Endpoint, authentication and limits

```
GET /api/events[?networkId=<uuid>][&topology=1][&lastEventId=<seq>]
Accept: text/event-stream
Cookie: easyplane_session=…        (HttpOnly, SameSite=Lax)
```

- Session-cookie authenticated. Without a valid session the response is
  `401 {"error":"authentication required"}` before any stream is opened.
- `networkId` filters delivery to one network (the map uses it).
- `topology=1` marks the connection as a topology viewer. That is a hint, not a
  permission: it only tells the collector that somebody is looking at the map
  and fast polling is worth the RPCs.
- `lastEventId` is the reconnect cursor (an `Last-Event-ID` header is also
  accepted, but `EventSource` cannot set headers, so the panel uses the query
  parameter).
- Limits are bounded per user and globally
  (`EASYPLANE_SSE_MAX_PER_USER`, default 4; `EASYPLANE_SSE_MAX_TOTAL`, default
  500). Exceeding the per-user cap returns `429 too many streams` before the
  stream opens, so a tab cannot spin up connections without bound.
- A consumer that stops reading is disconnected once `writableLength` exceeds
  1 MB; the browser reconnects with a resync instead of growing server memory.
- A 15 s comment frame (`: keep-alive …`) keeps proxies from closing the
  connection.

The hub is in-process and one organisation per deployment, so every event is
simply matched by organisation and (optional) network.

## 3. Events

Each frame carries a monotonic process-local `seq` as the SSE id and a JSON
payload:

```
id: 42
event: device.updated
data: {"seq":42,"type":"device.updated","at":"…","orgId":"…","networkId":"…","deviceId":"…","topics":["devices"],"data":{…}}
```

| event | emitted when | cache effect in the panel |
| --- | --- | --- |
| `hello` | a stream opens (includes user, role, heartbeat interval, cap) | status indicator |
| `resync` | the reconnect id is unknown (server restart, evicted from the ring) | invalidate every query |
| `device.updated` | join, heartbeat (coalesced), approval, block, rename, tags/owner, revision created, rollback, config pushed/failed, session closed | all `/api/devices*` and `/api/networks*` queries |
| `device.removed` | device deleted | same |
| `network.updated` / `network.deleted` | network created/updated/secret rotated/deleted | networks, devices, invites |
| `policy.updated` | policy saved or disabled (with the new version) | networks (policy/versions), devices (revisions) |
| `route.updated` | route requested/decided, or a client route report changed | networks (routes/reports), devices |
| `topology.updated` | each topology collection (whole snapshot, without raw observations) | patches the map query in place |

Heartbeats arrive every second per device, so `device.updated` is coalesced: an
event is emitted when any status field changes, otherwise at most every 5 s
(which is what keeps "last seen" moving). The event carries only status fields
and identifiers — never a secret, a config body or a token.

`topology.updated` is only delivered to streams that declared `topology=1`:
the snapshot is the largest payload and no other page needs it, so the shell
stream never receives it.

Clients must treat events as **cache hints**: the payload is not the full API
object. The one exception is `topology.updated`, which carries the snapshot
because re-fetching a large graph on every poll would defeat the purpose.

## 4. Reconnect, replay and resync

The panel's `useEventStream` opens one `EventSource` per subscription and, on
`error`:

1. closes the stream,
2. probes `/api/auth/me`; if the session is gone it stops and the app shows the
   login page (a dead cookie must not become an infinite reconnect loop),
3. otherwise waits `min(30 s, 1 s × 2^attempt)` with ±20 % jitter and reopens
   with `?lastEventId=<last seq>`.

The hub keeps the last `EASYPLANE_SSE_EVENT_BUFFER` events (default 500) in a
ring. Topology snapshots are never buffered (they are large and a reconnecting
map refetches the current one), which keeps hub memory independent of the fleet
size. A reconnect with an id still in the ring gets the missed events; an id
outside it (or from a previous process, e.g. after a restart) gets an explicit
`resync` event, and the provider invalidates every query. This makes server
restarts safe: the panel always converges, either by replay or by refetching.

## 5. Topology collection

`TopologyService` probes every approved device's managed instance with
`CollectNetworkInfo([inst_id])` — the same RPC M2 uses for route reports — and
keeps **one snapshot per network in memory** (bounded by the number of
networks; no history is stored).

- Only online devices (live config-server session) are probed; offline devices
  still appear as nodes with `online: false` so the map matches the device list.
- One snapshot is bounded: at most 5000 nodes, 20000 links and 1000 raw
  peer/route rows per observation (`TOPOLOGY_LIMITS`). Hitting a cap marks the
  snapshot `partial`; nothing is silently dropped from the JSON contract.
- `EASYPLANE_TOPOLOGY_CONCURRENCY` (default 4) bounds parallel RPCs;
  `EASYPLANE_TOPOLOGY_TIMEOUT_MS` (default 5 s) bounds one slow client;
  `EASYPLANE_TOPOLOGY_MAX_DEVICES` (default 500) bounds a cycle. A cycle with
  failures is marked `partial` instead of silently dropping data.
- **Adaptive interval:** collection runs every
  `EASYPLANE_TOPOLOGY_IDLE_INTERVAL_MS` (default 30 s) when nobody watches and
  every `EASYPLANE_TOPOLOGY_ACTIVE_INTERVAL_MS` (default 5 s) while at least one
  `topology=1` stream is open. `EASYPLANE_TOPOLOGY_JITTER` (default 0.2) spreads
  probes so panels do not synchronise. The floor is 1 s and the active interval
  can never exceed the idle one (unit-tested in
  `apps/server/test/unit/topology-scheduler.test.ts`).
- Opening the map also triggers a fresh collection when the cached snapshot is
  older than the active interval, so the first paint is current.
- Concurrent requests share the in-flight cycle (one probe fan-out per network),
  and the network list is re-discovered periodically so deleted networks free
  their snapshot.

### 5.1 Field mapping (what the client actually reports)

| Snapshot field | Source in `NetworkInstanceRunningInfo` |
| --- | --- |
| node identity, hostname, version | `my_node_info.{peer_id,hostname,version}`, `routes[].{peer_id,hostname,version}` |
| virtual IPv4 / prefix | `my_node_info.virtual_ipv4`, `routes[].ipv4_addr` |
| listeners | `my_node_info.listeners` |
| NAT type, public addresses | `my_node_info.stun_info.{udp_nat_type,tcp_nat_type,public_ip}`; peers: `routes[].stun_info.{udp_nat_type,tcp_nat_type}` |
| direct vs relayed | `routes[].cost` (1 = direct neighbour) and `peer.directly_connected_conns` |
| relay node | `routes[].next_hop_peer_id` (resolved to a node) |
| tunnel protocol | `peers[].conns[].tunnel.tunnel_type` (`tcp`, `tcp6`, `udp`, `ws`, `wss`, `quic`, `wg`, …) |
| RTT / loss | `peers[].conns[].stats.latency_us`, `conns[].loss_rate` (0..1) |
| direction | `peers[].conns[].is_client` (true = this side dialled) |
| underlay endpoints | `conns[].tunnel.{local_addr,remote_addr,resolved_remote_addr}` |
| bytes/packets | `conns[].stats.{rx,tx}_{bytes,packets}` |
| proxy CIDRs | `routes[].proxy_cidrs` |
| public-server / relay hints | `routes[].feature_flag.{is_public_server,avoid_relay_data,disable_p2p,…}` |
| client events | `events[]` |

EasyTier's own CLI uses the same rule for "DIRECT": `cost == 1`
(`easytier/src/easytier-cli.rs`), and the default connection and latency are
selected like `PeerRoutePair::{get_latency_ms,get_conn_protos,get_loss_rate}`
(`easytier-proto/src/api.rs`).

### 5.2 Derivation rules

- **Direct** when the peer has a directly connected connection, or the route
  cost is 1. **Relayed** otherwise; the relay is the node whose peer id equals
  `next_hop_peer_id`, and `cost` is the hop count.
- A relayed edge has no direct transport, so the protocol shown is the
  **first hop's** tunnel to the relay (`protocolIsFirstHop = true`). A relaying
  path can mix transports; the map never pretends the whole path is one tunnel.
- Edges are aggregated from both observers. If one side reports a direct
  connection and the other a relayed path, the link is marked `asymmetric` and
  both pieces of evidence are kept (shown in the link panel).
- Latency/loss come from the default (or best) connection for a direct edge and
  from `path_latency` for a relayed edge. Loss is only known per direct
  connection; a relayed edge reports `null`, not a fabricated number.
- NAT type and public addresses are reported per node. `StunInfo.public_ip` is
  only populated for the node's own report; for peers the observed public
  endpoint is the connection's remote address.

### 5.3 Relay capability and the "reachable node" warning

The map defines:

- **`reachable`** — the node reports an open or static NAT
  (`OpenInternet` / `NoPAT`, UDP or TCP) or the peer flag `is_public_server`.
  Only such a node can accept inbound connections without NAT help.
- **`relayCapable`** — `reachable`, **or** the node is demonstrably used as a
  relay (`next_hop_peer_id`) by another node. EasyTier relays through any peer
  both sides can reach, so a node behind NAT that already relays is useful even
  though it is not a public server.
- The snapshot exposes `capabilityReasons` (`nat:…`, `public-server-flag`,
  `relaying-for:N`) and the raw evidence, so the UI never shows a badge without
  a reason.
- When `stats.hasReachableNode` is false the map shows a warning: a deployment
  where every node is behind a NAT may fail to traverse it, and adding a
  reachable node (public server / port-forwarded host) is the fix. If relays
  are already observed, the warning says so instead of pretending the map is
  broken.

`PeerFeatureFlag.is_public_server` is set by upstream only in foreign-network
contexts (`easytier-core/src/peers/foreign_network/mod.rs`), so it is treated
as a hint; the STUN NAT type and observed relay usage are the primary signals.
This is documented because it means a *public server configured via
`public_server_url`* is not necessarily flagged by the client.

## 6. The map UI

`@xyflow/react` (React Flow 12) was chosen over a hand-rolled SVG/D3 graph
because it already provides pan/zoom, a minimap, node dragging, accessible
focus handling and custom HTML nodes — the parts that are easy to get wrong for
tens to hundreds of nodes — while leaving layout and styling under our control
(it ships no layout engine, so no force simulation jitters between snapshots).

**Layout** (`apps/web/src/lib/topology-layout.ts`):

- deterministic radial layout: the most connected relay-capable node is in the
  centre, each BFS hop is one ring further out;
- ring radius grows with the number of nodes on it (`n × max(minSpacing,
  nodeWidth)` / 2π), so 40 nodes on a ring do not overlap;
- O(V+E), stable across snapshots (a device keeps its ring and angle), and no
  extra dependency; users can still drag nodes, and their positions are kept
  until the node disappears;
- disconnected devices are placed on an outer ring rather than dropped.

**Visual language:** solid green = direct, dashed amber = relayed (label names
the relay, hop count and the first-hop protocol), a violet ring and tower badge
= relay-capable, muted dashed card = offline. Node cards show virtual IP, peer
id, NAT type and managed/unmanaged; a native tooltip lists public IPs,
listeners, version and what the node relays for. Selecting a node opens the
device drawer; selecting an edge opens the per-observer evidence panel. A
legend, a per-network filter and a "collected at / every N s" line make the
map's freshness explicit.

The page is lazy-loaded, so React Flow (~65 kB gzipped) is only downloaded when
the map is opened.

**Device drawer** (`apps/web/src/components/topology/device-drawer.tsx`) shows
the device's status fields plus the raw `CollectNetworkInfo` data: every peer
connection (id, tunnel type, RTT, loss, direction, remote address, bytes) and
the full route table (IP, cost, next hop, NAT type, proxy CIDRs). Nothing is
recomputed there, which lets an operator compare the map's derived edge with
the client's own numbers.

**en + ru:** every new string lives in `apps/web/src/i18n/{en,ru}.ts`; the
Russian translation covers the warning and the honest notes, not just labels.

## 7. What was verified and what was not

Verified against real clients (`test/conformance/m3.test.ts`, three containers,
hub-and-spoke, leaves with `disable_p2p`):

- the client itself reports `core-b → core-c` as `cost = 2` with
  `next_hop_peer_id = core-a`; the map's relayed edge matches it exactly
  (relay hostname, cost, first-hop `tcp`, `relaying-for` on the hub);
- direct edges carry `tcp`, real RTT/loss and the dialler/acceptor direction;
- NAT type and listeners come from the client's STUN report and listener list;
- stopping a container produces `device.updated{online:offline, reason:
  session-closed}` on a live SSE stream, starting it produces an online
  heartbeat event, and the REST view converges;
- the stream is refused without a session and above the per-user cap; opening
  the map registers a topology watcher and the snapshot reports the active
  1 s interval;
- ICMP between the two leaves still crosses the relay while probes run
  (`ping` succeeds), i.e. polling does not break data forwarding.

Implemented from sources / not exercised end-to-end:

- `wss`/`quic`/`wg` tunnel labels: the normaliser is unit-tested with the
  strings upstream produces (`tcp6`, `txt-tcp`, …), but the conformance mesh
  only uses `tcp`;
- non-open NAT types other than the Docker bridge's `PortRestricted`/`Symmetric`
  (e.g. `FullCone` → `natFriendly`) are mapped but not observed on a real
  public NAT;
- a genuinely public server (`public_server_url`) is not part of the
  conformance topology, so the `public-server-flag` capability reason is only
  unit-tested;
- the browser E2E path (EventSource in a real browser) is covered by unit and
  integration tests plus a served-build smoke test, not by Playwright.

Not done / known gaps:

- The event hub and snapshots are **in-process**. Run exactly one server
  replica; with several, a browser only sees events published by the replica it
  is connected to, and each replica probes devices independently. M4 reviewed
  this and left it as a documented hard limitation instead of a half-working
  multi-replica mode (docs/DEPLOY.md §6). Horizontal scaling needs a shared bus
  (Postgres `LISTEN/NOTIFY` or Redis), sticky config-server sessions, and shared
  limiter/draft state.
- Snapshots are memory-only and replaced wholesale: after a restart the map
  shows nothing until the first cycle, and there is no historical timeline.
- Only the managed instance per device is probed. A second instance inside the
  same `easytier-core` process (or a separate local process) is not on the map;
  route reports already flag those (docs/POLICY.md §7).
- The map cannot show traffic that bypasses the overlay (e.g. two peers
  connecting over the LAN outside EasyTier): the data comes from EasyTier's own
  route/connection tables.
- Peer ids are per instance. Two nodes are identified by their overlay IPv4;
  a peer without a route entry is shown under a synthetic id until the route
  table converges.
- Prometheus exposes the total `easyplane_sse_streams` gauge but not per-user
  or per-network stream counts (deliberate cardinality bound).

## 8. Configuration

| variable | default | meaning |
| --- | --- | --- |
| `EASYPLANE_SSE_MAX_PER_USER` | 4 | concurrent streams per user |
| `EASYPLANE_SSE_MAX_TOTAL` | 500 | concurrent streams per process |
| `EASYPLANE_SSE_EVENT_BUFFER` | 500 | events kept for Last-Event-ID replay |
| `EASYPLANE_TOPOLOGY_IDLE_INTERVAL_MS` | 30000 | collection interval with no map viewers |
| `EASYPLANE_TOPOLOGY_ACTIVE_INTERVAL_MS` | 5000 | interval while a map is open |
| `EASYPLANE_TOPOLOGY_JITTER` | 0.2 | ± fraction applied to both intervals |
| `EASYPLANE_TOPOLOGY_CONCURRENCY` | 4 | parallel `CollectNetworkInfo` calls |
| `EASYPLANE_TOPOLOGY_TIMEOUT_MS` | 5000 | per-device RPC timeout |
| `EASYPLANE_TOPOLOGY_MAX_DEVICES` | 500 | devices probed per network cycle |

See [DEPLOY.md](DEPLOY.md) for the reverse-proxy settings that SSE needs.
