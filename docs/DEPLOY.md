# Deploying EasyPlane (M2)

EasyPlane is one Node process plus PostgreSQL. The process serves the web UI,
the HTTP API and the EasyTier config-server listeners (`ws`, `wss`, `tcp`).
`docker compose up` builds and runs both.

```
browser ──https──▶ reverse proxy ──▶ server:8080  (UI + /api)
easytier-core ──wss──▶ reverse proxy ──▶ server:22023 (ws config-server)
easytier-core ──tcp──▶ server:22020
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

## 5. Operations

- `GET /health` returns database and client counts; the container healthcheck
  uses it.
- Logs are structured JSON (pino for HTTP, a small JSON logger for the control
  plane). Cookies, authorization headers and CSRF headers are redacted.
- Session housekeeping runs hourly; expired sessions and OIDC states are
  deleted.
- Unknown config-server tokens are rate-limited per source IP
  (`EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE`) and pending devices are capped
  per network (`EASYPLANE_MAX_PENDING_DEVICES_PER_NETWORK`).

Backups: `pg_dump` covers everything, **plus** `EASYPLANE_ENCRYPTION_KEY` —
without it the stored EasyTier network secrets cannot be decrypted. Rotating
that key is not implemented in M1.

```bash
docker compose exec postgres pg_dump -U easyplane easyplane | gzip > easyplane.sql.gz
```

## 6. M1/M2 limitations and risks

- **Run one server instance.** The device-session registry, unknown-token
  limiter and reconcile timer are in-process. A second replica could not push
  to devices connected to the first, and rate limits would be per replica.
  Horizontal scaling needs sticky config-server sessions or a shared registry.
- Blocking a device stops its instance via `DeleteNetworkInstance` only while
  it is connected. An offline blocked device cannot be reached; its EasyTier
  network keeps running locally until the process restarts, and its next
  heartbeat is refused. Deleting a device has the same property.
- The OIDC client authenticates at the token endpoint with
  `client_secret_post` (or no secret + PKCE). Providers that require
  `client_secret_basic`, mTLS or JWT client assertions are not supported yet.
- No UDP config-server transport and no encryption-key rotation. Losing
  `EASYPLANE_ENCRYPTION_KEY` makes stored network secrets unrecoverable.
- `machine_id` is self-reported by the client. Anyone holding a valid invite
  can claim a machine id; approval is the security boundary. Rotate/revoke
  invites if one leaks.
- No SSE/WebSocket browser updates: pages poll via TanStack Query refetch.
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
- No outbound calls except configured OIDC discovery/token/userinfo and
  EasyTier clients.
