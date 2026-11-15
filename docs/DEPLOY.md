# Deploying EasyPlane (M4)

EasyPlane is one Node process plus PostgreSQL. The process serves the web UI,
the HTTP API and the EasyTier config-server listeners (`ws`, `wss`, `tcp`).
`docker compose up` builds and runs both.

```
browser ──https──▶ reverse proxy ──▶ server:8080  (UI + /api + /metrics)
easytier-core ──wss──▶ reverse proxy ──▶ server:22023 (ws config-server)
easytier-core ──tcp──▶ server:22020
easytier-core ──udp──▶ server:22021 (optional, EASYPLANE_UDP_PORT)
server ──▶ postgres:5432
```

## 1. Quick start

```bash
cp .env.example .env
# edit .env: POSTGRES_PASSWORD, EASYPLANE_ENCRYPTION_KEY,
#            EASYPLANE_BOOTSTRAP_ADMIN_TOKEN, public URLs, OIDC providers
openssl rand -base64 32   # use for EASYPLANE_ENCRYPTION_KEY
openssl rand -base64 32   # use for EASYPLANE_BOOTSTRAP_ADMIN_TOKEN

docker compose up -d --build
docker compose logs -f server
```

Migrations are applied automatically at startup (`apps/server/drizzle`).
Open the panel, use **Break-glass bootstrap** once with the token and an admin
email, then sign in through OIDC. After an admin exists the token is refused
unless `EASYPLANE_BOOTSTRAP_REENABLE=true`; re-disable it afterwards.

## 2. TLS and reverse proxy

Two supported shapes:

**A. Reverse proxy terminates TLS (recommended).** The server listens on plain
HTTP/WS. Example nginx:

```nginx
# Panel + API
server {
  listen 443 ssl http2;
  server_name easyplane.example.com;
  # ssl_certificate ...;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Server-sent events: one long-lived response per tab. Buffering must be
  # off or the browser sees nothing until the connection closes.
  location = /api/events {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 3600s;
  }
}

# EasyTier config server: the invite token is the last path segment.
server {
  listen 443 ssl http2;
  server_name vpn.example.com;
  location / {
    proxy_pass http://127.0.0.1:22023;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }
}
```

Set `EASYPLANE_PUBLIC_CONFIG_SERVER_URL=wss://vpn.example.com` so invite
commands get the right URL. `EASYPLANE_TRUST_PROXY=true` makes Fastify honour
`X-Forwarded-*` for the OIDC redirect URI and client IP rate limiting.

The server already sends `X-Accel-Buffering: no` and a 15 s keep-alive comment,
which is enough for nginx/Caddy/Traefik as long as the `/api/events` route
disables response buffering and the read timeout is longer than the keep-alive.
If the panel shows "Reconnecting…" while the rest of the UI works, check the
proxy's buffering settings first. SSE connections count against the per-user cap
(`EASYPLANE_SSE_MAX_PER_USER`, default 4); a tab uses one, plus one while the
topology map is open.

**Caddy** (wss + SSE in one file, automatic certificates):

```caddyfile
easyplane.example.com {
    # SSE must not be buffered; everything else is a normal reverse proxy.
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}

vpn.example.com {
    reverse_proxy 127.0.0.1:22023
}
```

`flush_interval -1` is Caddy's equivalent of nginx `proxy_buffering off` and
covers `/api/events`; `reverse_proxy` handles the WebSocket upgrade for the
config-server automatically. Set `EASYPLANE_PUBLIC_CONFIG_SERVER_URL=wss://vpn.example.com`.

**B. The server terminates TLS itself.** Mount a certificate and set:

```
EASYPLANE_WSS_PORT=22024
EASYPLANE_TLS_CERT=/certs/fullchain.pem
EASYPLANE_TLS_KEY=/certs/privkey.pem
EASYPLANE_PUBLIC_CONFIG_SERVER_URL=wss://vpn.example.com:22024
```

EasyTier clients do not verify the config-server certificate, but the panel's
own HTTPS should still use a valid certificate (OIDC redirects, secure cookies).

Keep the `tcp://` listener (22020) only if clients need it; it carries no TLS
and the invite token travels in `HeartbeatRequest.user_token` (verified in the
upstream client: non-websocket schemes clear the URL path before dialling).

## 3. OIDC

Register one redirect URI per provider:

```
https://<panel-host>/api/auth/callback/<provider-id>
```

Only authorization code + PKCE is used; no passwords are stored. Multiple
providers can be configured in `EASYPLANE_OIDC_PROVIDERS`; users are matched by
`(issuer, subject)` and re-login with the same identity keeps the same account.
A provider can be a public client (no `clientSecret`) — PKCE S256 is always
sent. `roleClaim` is read from the ID token and, when `useUserinfo` is true,
merged with userinfo claims (later values win). Group names are matched
case-sensitively; a user in both admin and member groups is an admin.

### Keycloak

1. Create a confidential client `easyplane` in the realm.
2. Valid redirect URI: `https://<panel-host>/api/auth/callback/keycloak`.
3. Add a group membership mapper to the **ID token** (claim `groups`, group
   full path or name as you prefer), or leave `useUserinfo: true` and add it to
   userinfo.
4. Create groups `easyplane-admins` / `easyplane-members`.

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

### Authentik

1. Create an OAuth2/OpenID provider (confidential) with redirect URI
   `https://<panel-host>/api/auth/callback/authentik`.
2. Scope mapping: include `groups` in the ID token (Authentik's default
   `profile` scope already exposes groups in userinfo).
3. Application policy decides who may sign in; EasyPlane maps the groups.

```json
{
  "id": "authentik",
  "label": "Authentik",
  "issuer": "https://auth.example.com/application/o/easyplane/",
  "clientId": "...",
  "clientSecret": "...",
  "roleClaim": "groups",
  "adminGroups": ["easyplane-admins"],
  "memberGroups": ["easyplane-members"],
  "defaultRole": "viewer"
}
```

The issuer must be the exact `iss` value from
`https://auth.example.com/application/o/easyplane/.well-known/openid-configuration`
(Authentik includes the trailing slash).

### Google Workspace

Google has no groups claim in the ID token. Use `hd`/domain restrictions and
assign roles manually (or through a group-claim proxy):

```json
{
  "id": "google",
  "label": "Google",
  "issuer": "https://accounts.google.com",
  "clientId": "...apps.googleusercontent.com",
  "clientSecret": "...",
  "scopes": "openid email profile",
  "roleClaim": "groups",
  "adminGroups": [],
  "memberGroups": [],
  "defaultRole": "member",
  "allowedEmailDomains": ["example.com"]
}
```

With no matching groups every user gets `defaultRole`; set it to `viewer` and
promote the first admin through the break-glass token or a database update.
`allowedEmailDomains` is enforced **after** token validation and is the only
tenant boundary in a single-organisation deployment.

`EASYPLANE_OIDC_PROVIDERS` is a JSON array:

```json
[
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
]
```

- `roleClaim` may be an array claim or a space/comma separated string. Admin
  wins over member; no match gives `defaultRole`.
- Set `useUserinfo` (default true) if your IdP only puts groups in userinfo.
- Public clients without a secret are supported (PKCE S256 is mandatory).
- The issuer must match the discovery document exactly.

Roles are enforced server-side: viewers read everything except the audit log;
members additionally create invites and manage devices/config; only admins
create/delete networks, reveal/rotate secrets and read the audit log.

## 4. Connecting a device

Create a network, then an invite. The panel shows:

```
easytier-core --config-server wss://vpn.example.com/<invite-token> --hostname my-device
```

and the plain `wss://.../<token>` URL for the Android app. The client appears
as **pending** and receives no config until approved. On approval it gets the
next free address in the network CIDR and revision 1 of its desired config.
Changing the desired config creates a revision and pushes it immediately when
the device is online; on reconnect the server verifies the running instance and
re-pushes if needed. Blocking deletes the running instance and refuses the
token; deleting a device does the same and removes its history.

## 4b. Policy, MagicDNS and routes

- **Policy** lives per network (`/networks/:id/policy` in the panel). Saving a
  policy creates a new version and a config revision for every approved device
  in that network, then pushes. No policy means EasyTier's ACL filter is off.
  Read [docs/POLICY.md](POLICY.md) before locking a network down: the ingress
  chain defaults to drop, so a missing statement blocks traffic; egress is only
  restricted by explicit deny statements.
- **MagicDNS**: the per-network switch is pushed as `enable_magic_dns`. The
  zone is used for names in the panel only — EasyTier keeps `tld_dns_zone` in
  local client flags, so managed clients answer in `et.net.`. Keep the zone at
  `et.net.` unless every client runs its own instance with `--tld-dns-zone`.
  DNS names are unique per network; renaming pushes a new hostname without a
  revision.
- **Routes**: members request subnet/exit-node routes on the device page,
  admins approve them in the network page. Only approved routes are pushed.
  Route reports are collected every `EASYPLANE_ROUTE_REPORT_INTERVAL_MS`
  (default 30 s) from `CollectNetworkInfo`; a route the control plane never
  approved, or one advertised by an instance it did not create, is flagged and
  audited. A *separate* local `easytier-core` process is invisible to the
  control plane — see docs/POLICY.md §7 for what can and cannot be revoked.

## 4c. Importing an existing network

**Networks → Import network** (admin) accepts three sources and always shows a
preview + diff before saving:

1. **TOML**: paste or upload the file used by `easytier-core -c`. The network
   secret is read and preserved; it is never returned to the browser.
2. **Share link**: `https://…/comp_cfg?cfg=…` from the EasyTier GUI. The same
   zlib/base64url/pbjson format is used; the secret is preserved.
3. **From a device**: reads `GetNetworkInstanceConfig` from an online device.
   This is the migration path from another control plane or a hand-written
   config file: connect the client once, adopt, then point it at EasyPlane.

The preview lists the resulting `network_name`/CIDR/defaults and every source
feature EasyPlane does not import (proxy CIDRs/exit nodes are owned by route
approvals, ACL by the policy document, port forwards/VPN portal/credentials are
not managed). `network_name` is unique per deployment, so importing a network
that already exists returns `409`; the migration flow is to preview, delete the
old network (the draft keeps the secret) and commit the draft.

`GET /api/networks/:id/export?format=toml|share-link` produces the reverse
(admin only, audited; the output contains the secret by design). See
[PROTOCOL.md](PROTOCOL.md) §13.2 for the exact formats.

## 5. Operations

- `GET /health` returns database and client counts; the container healthcheck
  uses it.
- Logs are structured JSON (pino for HTTP, a small JSON logger for the control
  plane). Cookies, authorization headers, CSRF headers, secrets and tokens are
  never logged; a unit test scans every logger call for secret-looking fields.
- Session housekeeping runs hourly; expired sessions and OIDC states are
  deleted.
- **Rate limits**: a global per-IP HTTP limit
  (`EASYPLANE_API_RATE_LIMIT_PER_MINUTE`, default 600/min), stricter limits on
  auth (30/min), import preview/commit (20 and 10/min), secret reveal (30/min),
  rotate (10/min), export (20/min) and invite creation (60/min). Config-server
  tunnels have a per-IP admission limit
  (`EASYPLANE_CLIENT_ACCEPT_LIMIT_PER_MINUTE`), a hard connection cap
  (`EASYPLANE_MAX_CLIENT_CONNECTIONS`) and an unknown-token limiter
  (`EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE`); pending devices are capped per
  network (`EASYPLANE_MAX_PENDING_DEVICES_PER_NETWORK`).
- **Session timeouts**: a config-server tunnel that sends no heartbeat for
  `EASYPLANE_CLIENT_HEARTBEAT_TIMEOUT_MS` (20 s) is closed — that is how
  half-open TCP/dead NAT sessions are reclaimed. UDP sessions also have a
  two-minute datagram idle sweep. Browser sessions have a rolling idle timeout
  (`EASYPLANE_SESSION_IDLE_MINUTES`, 12 h) and an absolute cap
  (`EASYPLANE_SESSION_ABSOLUTE_HOURS`, 7 days), stored in PostgreSQL.
- **Metrics** (optional): set `EASYPLANE_METRICS_TOKEN` and scrape
  `GET /metrics` with `Authorization: Bearer <token>`, or set
  `EASYPLANE_METRICS_PORT` to serve `/metrics` + `/health` on an internal-only
  listener (`EASYPLANE_METRICS_HOST`, default `127.0.0.1`). The endpoint is
  disabled otherwise.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: easyplane
    metrics_path: /metrics
    scheme: http
    authorization:
      credentials: <EASYPLANE_METRICS_TOKEN>
    static_configs:
      - targets: ["easyplane.internal:8080"]
```

Exposed: `easyplane_clients_connected`, `_client_sessions_total`,
`_client_connections_rejected_total`, `_clients_reaped_total`,
`_heartbeats_total`, `_unknown_config_server_tokens_total`,
`_config_pushes_total{status}`, `_sse_streams`, `_topology_cycles_total`,
`_network_imports_total{source}`, `_database_up`, RSS, uptime and HTTP request
counts. No network/device names, tokens or secrets are exposed.
- Browser updates are pushed over SSE (`GET /api/events`, session cookie,
  role-checked, bounded per user). No polling interval needs tuning.
- The topology map probes each online device with `CollectNetworkInfo`. Its cost
  is bounded by `EASYPLANE_TOPOLOGY_CONCURRENCY` (default 4 parallel RPCs) and
  runs every `EASYPLANE_TOPOLOGY_IDLE_INTERVAL_MS` (30 s) when nobody is
  watching, `EASYPLANE_TOPOLOGY_ACTIVE_INTERVAL_MS` (5 s) while a map is open,
  with ±`EASYPLANE_TOPOLOGY_JITTER` (20 %) spread.
  `EASYPLANE_TOPOLOGY_MAX_DEVICES` (500) caps one cycle and a failed probe marks
  the snapshot `partial` in the UI. See [REALTIME.md](REALTIME.md) §5.

Backups: `pg_dump` covers everything, **plus** `EASYPLANE_ENCRYPTION_KEY` —
without it the stored EasyTier network secrets cannot be decrypted. Rotating
that key is not implemented in M1.

```bash
docker compose exec postgres pg_dump -U easyplane easyplane | gzip > easyplane.sql.gz
```

## 6. Limitations and risks (M1–M4)

- **Run exactly one server instance.** This is a hard limitation, not a tuning
  note. In-process state includes: the device-session registry (a push can only
  reach a device connected to the same process), the unknown-token and
  connection limiters, the reconcile timer (every replica would re-push every
  device), the per-network approval queue (two replicas could allocate the same
  address), the SSE event hub (events would reach only the publishing replica's
  browsers), topology snapshots, and import drafts (a commit hitting another
  replica would fail). The database is shared and safe, but the control plane
  is not. Horizontal scaling needs sticky config-server sessions, a shared
  event bus, a distributed limiter/queue and sticky or shared drafts; none of
  that is implemented. Run one replica behind a plain reverse proxy (it is
  stateless from the browser's point of view only if it is the only one).
- The topology map is memory-only: after a restart it is empty until the first
  collection (seconds when a map is open, up to the idle interval otherwise),
  and there is no history. Only the managed instance of each device is probed;
  a second local `easytier-core` process is not on the map.
- Blocking a device stops its instance via `DeleteNetworkInstance` only while
  it is connected. An offline blocked device cannot be reached; its EasyTier
  network keeps running locally until the process restarts, and its next
  heartbeat is refused. Deleting a device has the same property.
- The OIDC client authenticates at the token endpoint with
  `client_secret_post` (or no secret + PKCE). Providers that require
  `client_secret_basic`, mTLS or JWT client assertions are not supported yet.
- No encryption-key rotation. Losing `EASYPLANE_ENCRYPTION_KEY` makes stored
  network secrets unrecoverable. Back it up with the database.
- Import drafts, export, and the optional internal metrics listener are
  single-process features for the same reason as above. The `/metrics` route on
  the main app is also per-process.
- `network_name` is unique per deployment, so an imported network cannot
  coexist with a network that already uses the same EasyTier identity; migrate
  by deleting the old network after previewing (the draft keeps the secret).
- `machine_id` is self-reported by the client. Anyone holding a valid invite
  can claim a machine id; approval is the security boundary. Rotate/revoke
  invites if one leaks.
- The map's "reachable/relay-capable" badge is derived from the client's STUN
  NAT type and observed relaying; it is not a reachability probe. A node behind
  NAT can still relay for peers that reach it, which is why the map also
  highlights observed relays.
- Policy is enforced at the destination only. EasyTier has no outbound
  connection tracking, so the outbound chain is default-allow (docs/POLICY.md
  §6). A hostile member can spoof source IPs in data packets unless
  `options.strictTags` is enabled, which in turn hands the tag secret to the
  verifier.
- MagicDNS zone cannot be pushed (client flag only). Route approval is manual —
  there are no auto-approvers yet.
- One organisation per deployment, roles are deployment-wide.
- No browser E2E suite yet (the UI is covered by unit tests, typecheck, lint
  and a served-build smoke test).
- The load test is loopback-only and simulated on the client side; see
  [PERFORMANCE.md](PERFORMANCE.md) for the measured envelope (200–500 clients,
  p99 heartbeat latency, ~0.2 MB/client) and what it does not cover.
- No outbound calls except configured OIDC discovery/token/userinfo and
  EasyTier clients.
