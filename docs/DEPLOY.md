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
devices ⇄ rendezvous:11010/11011 (optional public easytier-core, opt-in profile)
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

Prefer a released image over a local build? See §1b — it is the same stack
with `image:` instead of `build:`.

## 1b. Published images and releases

CI publishes the server image to GitHub Container Registry. A fork publishes
into its own namespace (`ghcr.io/<owner>/<repo>`, lowercased).

| tag | produced by | meaning |
| --- | --- | --- |
| `edge` | every green push to `main` | last commit whose proto, unit, integration, conformance and image gates passed |
| `sha-<short>` | every publish | immutable pointer to the commit |
| `X.Y.Z`, `X.Y`, `X` | a release | the tagged release; `X.Y`/`X` move with newer releases |
| `latest` | a release | alias of the newest release |

Nothing is published from pull requests (CI only builds the image there).

**Run a published image (no local build):**

```bash
cp .env.example .env      # edit it exactly as in §1
docker compose -f docker-compose.ghcr.yml up -d --pull always
```

`docker-compose.ghcr.yml` is an alternative to `docker-compose.yml`, not an
addition: use one or the other. Pin a release with `EASYPLANE_IMAGE_TAG`
(in the environment or in `.env`, which compose reads for interpolation), and
pull explicitly when a moving tag like `latest` or `edge` should be refreshed:

```bash
EASYPLANE_IMAGE_TAG=1.2.3 docker compose -f docker-compose.ghcr.yml pull
EASYPLANE_IMAGE_TAG=1.2.3 docker compose -f docker-compose.ghcr.yml up -d
```

A bare `docker pull ghcr.io/maksimkurb/easyplane:1.2.3` works too. The image
reports the version it was built from at `GET /health` (`"version": "1.2.3"`,
or `"edge"` on main); it is baked in as `EASYPLANE_VERSION` at build time.

**Cutting a release.** Run the `release` workflow (Actions → release → Run
workflow) on `main`:

1. Pick `bump` (`patch` default, or `minor`/`major`), or set `version` to an
   explicit `X.Y.Z` — the explicit value wins.
2. The workflow requires a successful `ci` run on the selected commit; it then
   computes the next version from the newest `v*` tag (the first release is
   `v0.1.0`), creates the annotated tag, publishes a GitHub Release with
   generated notes, and builds/pushes `X.Y.Z`, `X.Y`, `X`, `latest` and
   `sha-<short>` for `linux/amd64` and `linux/arm64`.
3. Deploy it: run
   `EASYPLANE_IMAGE_TAG=X.Y.Z docker compose -f docker-compose.ghcr.yml pull`,
   then the same command with `up -d`.

For a fork, also set `EASYPLANE_IMAGE_OWNER=<owner>` (it defaults to the
upstream namespace).

Re-running is safe: a tag that already exists on the same commit is reused and
an existing release is left unchanged; choosing a version that is tagged on a
different commit fails instead of moving the tag.

**Tag push.** Pushing a `v*` tag by hand
(`git tag -a v1.2.3 -m "EasyPlane v1.2.3" && git push origin v1.2.3`) publishes
the same image set for that commit without creating a release and without
re-tagging. Note that a tag pushed by the workflow's `GITHUB_TOKEN` does not
trigger other workflow runs, so the release workflow publishes its own image;
the hand-push path is for rebuilding or re-publishing an existing tag.

**Package visibility (manual, once).** New ghcr packages are private by
default. To let anyone pull without credentials: repository → **Packages** →
`easyplane` → **Package settings** → **Change visibility** → **Public**. For a
private package, log in first with a PAT that has `read:packages`:

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
```

**Permissions.** The workflows use the built-in `GITHUB_TOKEN` only and declare
what they need (`packages: write`, and `contents: write` for the release job);
no repository setting has to change for a personal repository. An organisation
that enforces restricted workflow permissions must allow those scopes, and
publishing requires that Actions can create packages in the org.

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

- **Policy** lives per network (`/networks/:id/policy` in the panel). The
  access page has three modes: **open** (no ACL pushed), **rules** and
  **json** (the same document as HuJSON). Saving a policy creates a new version
  and a config revision for every approved device in that network, then pushes.
  Read [docs/POLICY.md](POLICY.md) before locking a network down: the ingress
  and forward chains default to block, so a missing statement blocks traffic.
  Egress defaults to allow; if you switch it to block, the compiler emits the
  egress and reply rules an allow needs, but a flow whose source is not covered
  by a rule is dropped.
- **Upgrade note (policy v2).** Migration `0007` adds `networks.policy_mode`,
  `user_groups` and `user_group_members`. Existing networks with a policy are
  marked `rules`; version-1 documents stay readable and are upgraded to v2 on
  the next save (the API reports `upgradedFromV1`). v1 `groups` and `tags`
  become user groups and device tags; nothing is deleted. The new access page
  points at the same `/networks/:id/policy` endpoints; older deployments that
  scripted the v1 `acls` document keep working.
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

### Behaviour change: every device gets an explicit route list

EasyTier installs **every** proxy CIDR a peer advertises unless the instance has
`enable_manual_routes` set. The panel now always pushes
`enable_manual_routes = true` with the explicit approved list:

- a device with *Accept subnet routes from the network* gets
  `routes = [<approved subnet routes of other devices>]`;
- a device without it gets `routes = []` and installs **no** subnet routes.

Before this change a device that never opted in silently installed every
advertised route. If a site relied on that, enable *Accept subnet routes* on the
devices that need reachability (device page → desired config) and let the panel
re-push. This is a security fix, not a cosmetic default: without it an
unapproved advertisement reaches every member's kernel routing table.

The pinned client cannot report "manual routes with an empty list" (the flag is
omitted when `routes` is empty), so drift comparison cannot see the old state.
The panel therefore pushes **once** to every approved device after the upgrade
(`devices.manual_routes_enforced_at`); no revision is created and the push is
the normal idempotent one.

### Device-declared routes: "stop the client, edit the file, start it"

Tailscale-style declarations are supported on the **managed** instance itself.
The client must persist its config, which needs `--config-dir`:

```bash
easytier-core \
  --config-server wss://vpn.example.com/<invite-token> \
  --config-dir /var/lib/easytier-client \
  --hostname my-router
```

After approval the client writes `/var/lib/easytier-client/<instance-id>.toml`.
To declare routes:

1. **Stop** `easytier-core` on the device.
2. Edit `<config-dir>/<instance-id>.toml` (the file name is the instance UUID
   shown by `ListNetworkInstance`; it is the `instance_id` inside the file):

   ```toml
   # ... the panel-written config, unchanged ...

   [[proxy_network]]
   cidr = "192.168.50.0/24"

   [flags]
   enable_exit_node = true
   ```

3. **Start** `easytier-core` with the same arguments. The instance reloads from
   the file and reports the declaration in its own config
   (`GetNetworkInstanceConfig`).
4. The panel creates a **pending** proposal ("Declared by device") for every
   subnet and for the exit-node flag. An admin approves or rejects it on the
   network's routes card. Pending declarations are *adopted* by the panel on
   every push, so the edit is not erased while it waits; approval distributes
   the subnet to devices that accept routes. Rejection removes it from the
   device's config on the next push (config-dir file) and never distributes it.

Notes and limits:

- The file contains the network secret; it is written `0600`. Do not paste it
  into tickets.
- The panel rewrites the file on every push. Only `[[proxy_network]]` and
  `enable_exit_node` are carried over from a local edit; change anything else in
  the panel, not in the file.
- A **read-only** file (an external `-c` outside the config dir, or mode `0444`)
  is a different mode: the panel can neither read its config nor push to it.
  The device shows "configuration is managed locally", no retry loop is created,
  and only other members' route tables can reveal a CIDR (never the exit-node
  flag). Use `--config-dir` for the workflow above.
- Do **not** rename the file or change `instance_id`: the panel's deterministic
  id no longer matches, so it starts a second instance next to yours and cannot
  attribute the declaration. Keep `<instance-id>.toml` in the config dir.
- Approved exit nodes are **consent only**. The panel never pushes `exit_nodes`
  to clients. Working egress needs the client to name the exit node *and* an OS
  route into the tunnel — see the OpenWrt section below.

### OpenWrt / Linux clients and exit nodes

EasyTier's `exit_nodes` decides where a packet that already reached the overlay
is sent; it does not touch the OS routing table. Approving an exit node in the
panel therefore does not make any client use it.

**Variant A — full tunnel (split default).** Keep the control-plane/peer
underlay on the physical interface and send everything else through the TUN.
The host routes for the peers' public addresses are essential; without them the
`/1` routes capture the tunnel's own underlay traffic.

```sh
# Replace with the public/underlay addresses this device dials (config-server,
# hubs, public nodes). Keep the LAN reachable if you need local access.
for peer in 203.0.113.10 198.51.100.20; do
  ip route replace "$peer/32" via "$(ip route show default | awk '{print $3; exit}')" dev br-lan
done
ip route add 0.0.0.0/1 dev tun0
ip route add 128.0.0.0/1 dev tun0
```

The client's own config must also name the exit node (`exit_nodes =
["10.144.144.5"]` in TOML, or the equivalent client setting). *[verified in a
Linux netns by the conformance suite: with the split default and `exit_nodes`
the flow passes; without `exit_nodes`, or without the route, it does not. Not
exercised on OpenWrt itself.]*

**Variant B — policy routing for selected LAN hosts.** Send only chosen sources
through the tunnel, leaving the rest of the LAN on the normal uplink:

```sh
ip rule add from 192.168.50.0/24 lookup 100
ip route add default dev tun0 table 100
ip route add <peer-public-ip>/32 via <gateway> dev br-lan  # keep underlay direct
```

This is standard Linux policy routing; no EasyTier involvement beyond
`exit_nodes`. *[source-level: not exercised by the conformance suite, which has
no second LAN to select from.]*

**Variant C — subnet routes only.** No exit node: a device that accepts routes
gets the approved subnet CIDRs in `enable_manual_routes` and the panel never
installs anything else. This is the default panel behaviour and is what the
conformance suite verifies. *[verified]*

For all variants the declaration lives on the router; clients only need the
approved route/exit-node configuration. The panel deliberately does not manage
per-client `exit_nodes` yet (see docs/POLICY.md §9).


## 4c. Importing an existing network

**Networks → Import network** (admin) opens the dedicated
`/networks/import` page and accepts three sources; the page always shows a
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

## 4d. Hubs, peer lists and the self-dial loop

Every device dials the peer URLs in its pushed config. A list that is the same
for the whole network eventually contains a device's own public URL, so that
device dials its public address, reaches itself and loops with
`peer id conflict, are you connecting to yourself?` in the core log. EasyPlane
therefore builds the peer list **per device at push time**:

- a device's **Advertised endpoints** (device page, member/admin) are the URLs
  other devices should dial, e.g. `tcp://h-1.node.kurb.me:11010`;
- **Use as hub** (device page, admin) adds the device to the network's ordered
  **Peers** list as a device-backed entry (network page);
- only **approved** hubs contribute endpoints, and the target device's own
  entry is excluded by `device_id`/`machine_id`; raw external URLs are pushed
  verbatim unless linked to a device;
- a device that is the only hub gets an empty list — it listens, it does not
  dial.

Changing endpoints/hub flags repushes the devices that dial them (no revision,
audited, SSE `network.updated`). Nothing is inferred from DNS or IPs: a raw URL
is offered for linking only when it exactly equals a device's advertised
endpoint, and linking adds the URL to that device's endpoints and converts the
entry to device-backed.

### Upgrading from broadcast peer URLs

Migration `0002` copies every existing `peerUrls` value — from
`networks.default_config` and from each `config_revisions.config` — into the
new peer list as a **raw** entry, deduplicated and ordered (network defaults
first, then revisions). Nothing is lost and the same URLs are pushed. It cannot
know which URL belongs to which device, so the self-dial loop persists until an
operator links them:

1. for each hub, open the device page and add its public endpoint(s) under
   **Advertised endpoints**;
2. toggle **Use as hub**;
3. on the network page, link the raw URL to that device (**Link to device**).
   The URL becomes device-backed, the device stops receiving it, and it is
   still pushed to everyone else;
4. repeat for every hub, then remove raw entries that nothing dials anymore.

The old JSON is left in place, so a downgraded image still sees it.

## 4e. Rendezvous node

A **rendezvous node** is a stock `easytier-core` running as a public node: a
well-known peer that devices dial so they can find each other, exchange peer
RPC/OSPF routes and coordinate NAT hole punching. It is not a VPN exit. By
default it **does not forward user data**; traffic goes directly between
devices whenever their NAT allows it. Relaying is an explicit opt-in for
symmetric NAT/CGNAT users who cannot get a direct path.

> The node does not implement EasyTier itself and is not a fork: EasyPlane only
> adds its peer URLs to a network's compiled list. The exact source behaviour,
> including the private-mode check and the `disable_relay_data` drop path, is
> cited in [PROTOCOL.md](PROTOCOL.md) §14.

### Enable it

```bash
# one node with the panel, opt-in profile
docker compose --profile rendezvous up -d --build

# or on a separate VPS, without the panel or a database
docker compose -f docker-compose.rendezvous.yml up -d
```

Both use the stock `easytier/easytier:v2.7.0` image (`RENDEZVOUS_IMAGE`
overrides it) and mount `docker/rendezvous/entrypoint.sh`, which renders a TOML
config and execs `easytier-core`. The node needs **no TUN device and no
capabilities**: it only accepts peer connections. A custom `RENDEZVOUS_IMAGE`
must provide `easytier-cli` for the healthcheck (or override the healthcheck
with `RENDEZVOUS_IMAGE`-specific settings).

Set on the node (`.env` for the compose files):

| variable | default | meaning |
| --- | --- | --- |
| `RENDEZVOUS_NETWORK_SECRET` | — (**required**) | the node's EasyTier secret; the who-may-use-it key. `openssl rand -base64 32` |
| `RENDEZVOUS_NETWORK_NAME` | `easyplane-rendezvous` | the node's own EasyTier network name (never a secret) |
| `RENDEZVOUS_RELAY_DATA` | `false` | `true` = forward user data (CGNAT fallback) |
| `RENDEZVOUS_PRIVATE_MODE` | `true` | reject networks that cannot prove the secret |
| `RENDEZVOUS_NETWORK_WHITELIST` | `*` | space-separated wildcard network names allowed to use the node |
| `RENDEZVOUS_RELAY_ALL_PEER_RPC` | `false` | with a whitelist: let non-whitelisted networks rendezvous but never relay |
| `RENDEZVOUS_LISTENERS` | `tcp://0.0.0.0:11010,udp://0.0.0.0:11010,ws://0.0.0.0:11011` | peer listeners |
| `RENDEZVOUS_MAPPED_LISTENERS` | — | public URLs to advertise behind 1:1 NAT/port mapping |
| `RENDEZVOUS_HOSTNAME` | `rendezvous` | hostname in logs and the map (`PublicServer_<hostname>`) |
| `RENDEZVOUS_FOREIGN_RELAY_BPS_LIMIT` | — | optional bytes/second cap on foreign-network relay (only matters when relay is on) |
| `RENDEZVOUS_SECURE_MODE` | `true` | **keep it on**: private mode's secret proof only exists in secure mode |
| `RENDEZVOUS_TCP_BIND` / `_UDP_BIND` / `_WS_BIND` | `0.0.0.0:11010` / `0.0.0.0:11010` / `0.0.0.0:11011` | host port mappings |

Set on the panel (`EASYPLANE_*`):

| variable | meaning |
| --- | --- |
| `EASYPLANE_RENDEZVOUS_ENDPOINTS` | comma-separated peer URLs every opted-in device dials, e.g. `tcp://rv.example.com:11010,udp://rv.example.com:11010,ws://rv.example.com:11011`. Empty hides the feature |
| `EASYPLANE_RENDEZVOUS_RELAY_DATA` | display only: show "relay on" in the card (match the node) |
| `EASYPLANE_RENDEZVOUS_PRIVATE_MODE` | display only: show "shared secret required" |
| `EASYPLANE_RENDEZVOUS_NETWORK_NAME` | display only: the node's network name |
| `EASYPLANE_RENDEZVOUS_SECRET` | optional: the **same** secret as the node. Enables exact checks and the audited "align network secret" action. Never returned by an API |

Forward/publish on the VPS firewall:

- **TCP 11010** (peer listener)
- **UDP 11010** (peer listener; UDP hole punching is the useful one)
- **TCP 11011** (ws listener; optional, put a TLS proxy in front for `wss`)

The node has a healthcheck (`easytier-cli -o json node`) and `cap_drop: ALL`.

### The shared-secret model (important)

Private mode is the default. The node admits a foreign network only when the
peer proves the node's `network_secret` (HMAC over the Noise handshake,
`PROTOCOL.md` §14.3). Networks keep their own `network_name`, so they stay
isolated from each other, but **one node has one secret**:

1. reveal the network secret in the panel (admin, audited) and start the node
   with `RENDEZVOUS_NETWORK_SECRET=<that value>` — the dedicated-node model; or
2. run one shared node for several networks and give every network the same
   secret. The network page's **Bundled rendezvous node** card shows whether the
   secret matches when `EASYPLANE_RENDEZVOUS_SECRET` is set, and offers an
   audited **Align network secret** action (rotates the network secret to the
   node's and repushes every device); or
3. if the panel does not know the node secret, enabling the toggle asks for an
   explicit acknowledgement. A mismatch is not detected until the node log
   says `private mode is turned on, foreign network secret mismatch`.

**Secure mode is part of the contract.** The secret proof is only exchanged in
EasyTier secure mode, so enabling the per-network toggle also pushes
`secure_mode: { enabled: true }` to every device in that network and the node
runs with secure mode. Without it, even a correct secret is rejected when the
network names differ (the digest includes the network name). The node's
`RENDEZVOUS_SECURE_MODE=true` default should not be changed for a private node.

### Per-network toggle, p2p_only and warnings

On a network page, admins get:

- **Use bundled rendezvous node** — appends the configured endpoints to every
  device's pushed peer list (compiled like a raw external entry, de-duplicated
  with hub/raw URLs, never self-excluded). The change is audited, broadcast
  over SSE and repushes the network; no revision is created.
- **p2p_only (advanced)** — pushes `p2p_only` to every device. A device then
  refuses to send to peers it does not have a direct connection with. Useful to
  verify that a network really is direct-only; harmful when CGNAT users rely on
  relay. The UI warns about exactly that.
- A warning when the network has **no hub, no external peer URL and no
  rendezvous endpoint**: devices then have nothing to dial and only connect on
  the same LAN or when they already know each other's addresses.

The card is read-only for members/viewers; toggles and secret alignment are
admin-only. `GET /api/rendezvous` exposes the endpoints, relay/private display
flags and whether secret comparison is available — never the secret.

### Whitelist and relay limits

`RENDEZVOUS_NETWORK_WHITELIST` matches EasyTier network names with wildcards
(`*`, `team-*`, `net1 net2`). With `relay_all_peer_rpc=false` a non-listed
network is rejected entirely; with `true` it may still use the node for
discovery/peer RPC, but only listed networks get data relay. Use the latter when
the node relays `RENDEZVOUS_RELAY_DATA=true` and you want to limit who consumes
bandwidth, while still letting every secret-holding network discover peers.

### Privacy, abuse and rotation

- **Who can use it:** anyone who knows `RENDEZVOUS_NETWORK_SECRET` and is
  admitted by the whitelist. The secret authenticates a *network*, not a device;
  a leaked secret is a leaked node credential. To rotate: change
  `RENDEZVOUS_NETWORK_SECRET` on the node and `EASYPLANE_RENDEZVOUS_SECRET` on
  the panel, restart both, then run **Align network secret** on every network
  (it sets the network secret to the node's and repushes). The panel refuses the
  ordinary random `/secret/rotate` while the toggle is on, because a random
  secret is guaranteed to stop matching the node.
- **What leaks:** the node sees connection metadata — network names, peer ids,
  virtual IPs, timing and volume. It does not see the payload plaintext
  (EasyTier encrypts peer traffic). A relay operator additionally sees traffic
  patterns and must pay for the bandwidth.
- **Open node:** `RENDEZVOUS_PRIVATE_MODE=false` removes the gate. Combined with
  `RENDEZVOUS_RELAY_DATA=true` it lets anyone relay through your host; only do
  that if you intend to run a genuinely public service.
- **Rate limiting:** `RENDEZVOUS_FOREIGN_RELAY_BPS_LIMIT` caps relayed bytes per
  second (use it on any public relay). A serious public service should also add
  host-level firewalling and connection limits. The node is deliberately small
  and has no panel database, so treat it as an untrusted public endpoint.
- **Logging:** the node logs network names and connection events but the
  entrypoint never prints the secret; the rendered TOML is mode 600 and the
  effective config in logs is redacted by the core. The healthcheck discards
  `easytier-cli` output because that output includes the config.

### Verification

`test/conformance/rendezvous.test.ts` drives the **real pinned**
`easytier-core` (the same binary the rest of the suite uses) and proves:

1. two leaves that can reach each other and the node exchange HTTP with relay
   **off** (direct route, `cost=1`);
2. two leaves on disjoint networks cannot exchange data with relay off;
3. with `RENDEZVOUS_RELAY_DATA=true` they can, and `CollectNetworkInfo` reports
   a relayed route (`cost>1`, `next_hop=PublicServer_…`) — the same data the map
   renders;
4. a leaf with a different secret is rejected (`private mode is turned on,
   foreign network secret mismatch`);
5. a strict whitelist rejects non-listed networks, and
   `relay_all_peer_rpc=true` admits them for discovery while still not relaying
   data.

## 4f. Credential-mode networks (per-device access)

A network can authenticate devices with per-device credentials instead of one
shared secret (**Device authentication** on the network page). The full design,
the wire contract and the measured limits are in
[docs/CREDENTIALS.md](CREDENTIALS.md); this section is the operator view.

### Roles and the one rule that matters

- **Anchors** hold the network secret, receive every member's credential in
  `managed_credentials`, and publish the trusted key list. They are trusted
  permanently: removing one from the panel does **not** revoke its knowledge.
  Only a secret rotation does.
- **Members** join with a revocable X25519 credential and never see the secret.
- A credentials network needs at least one **approved** anchor, and at least one
  anchor **online** for new members to connect through a rendezvous node. Two
  always-on anchors are the recommended deployment. The network card warns at
  zero and at one anchor.

### Enable it

1. Network page → **Device authentication** → **Switch to per-device
   credentials**.
2. Pick the anchors (servers/VPS nodes) in the dialog and run the dry-run
   preview.
3. Apply. The selected devices keep the secret; every other approved device
   becomes a member and receives a credential immediately.
4. Create invites with the new "What kind of device is this?" choice (anchor or
   regular device). The very first device of a credentials network must be an
   anchor; the API rejects a member before that.

The reverse migration (**Switch back to a shared secret**) gives every device
the secret again and revokes all credentials. Removed devices can join again
until the secret is rotated; the dialog requires an explicit acknowledgement.

### Credential lifetime and renewal

- `EASYPLANE_CREDENTIAL_TTL_DAYS` (default 90) and
  `EASYPLANE_CREDENTIAL_RENEW_BEFORE_DAYS` (default 14) control issue/renewal.
  Renewal runs hourly, is batched per network and is idempotent.
- **Every credential change restarts the anchors' EasyTier instance** (the
  config-server channel has no hot patch); expect a short blip on revoke and on
  renewal. Keep the TTL long unless you have a reason not to.
- Audit entries: `credential.issued`, `credential.reissued`,
  `credential.renewed`, `credential.revoked`, `credential.revoked_all`,
  `credential.groups_updated`, `network.access_mode_changed`,
  `device.role_changed`, `device.anchor_removed_acknowledged`. No key material
  is ever in them.

### Revoking and removing devices

- **Member:** one click (**Revoke access**) revokes the key, repushes anchors,
  deletes the running instance and blocks the device. Re-approving issues a new
  key. A live session through a rendezvous node can take up to ~2 minutes to
  drop (upstream OSPF/GC timing); the anchors and expiry act within seconds.
- **Anchor:** block/delete shows a blocking dialog that explains the device
  still knows the secret and offers a secret rotation. "Remove anyway" is
  audited. Removing the device also drops its endpoint from the network peer
  list, so other devices stop dialling it.

### Rotating the secret

`POST /api/networks/:id/secret/rotate` (or the removal dialog) gives every
device a new secret and repushes them. **Member credentials stay valid**:
members never verify the HMAC proofs and anchors re-sign them with the new
secret. If the network uses the bundled rendezvous node, rotate the node's
secret in the same window — its private mode admits only its own secret:

1. set the new `RENDEZVOUS_NETWORK_SECRET` on the node and
   `EASYPLANE_RENDEZVOUS_SECRET` on the panel, restart both;
2. rotate/align the network secret and let the anchors repush.

Rotating only the anchors while the node keeps the old secret makes the node
reject them (`private mode is turned on, foreign network secret mismatch`).

### Import

A credential-mode `NetworkConfig` (`secure_mode.local_private_key` or
`credential_file` with no `network_secret`) is still refused: the private key is
a *device* identity, not a network, and adopting it would either break the
chain or open the network. Create the network, add the device as a member and
use the credential the panel issues.

## 5. Operations

- `GET /health` returns database and client counts plus the version (from
  `EASYPLANE_VERSION`, which published images set to the image tag); the
  container healthcheck uses it.
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

### M4 security review (what was checked and fixed)

Reviewed in M4: OIDC login, sessions/CSRF, role checks on every route, SSE
authentication/limits, the config-server admission path, import parsing, secret
handling in logs/audit/API responses, and the unauthenticated RPC surface.

Fixed findings:

- `returnTo` after login accepted `//host`-style protocol-relative paths (and
  browser-normalised backslashes) — an open redirect. It is now resolved
  against a fixed origin and only same-origin paths survive.
- The public-route bypass in the auth hook used the raw URL; a crafted path
  could inherit it. It now uses the matched route pattern (with a traversal
  guard for unknown routes).
- The rate limiter's structured payload reached the global error handler as a
  non-`Error`, turning a 429 into a 500. It is surfaced as `code=rate_limited`.
- RPC piece reassembly was bounded per piece but not in aggregate; an
  unauthenticated tunnel could make the server allocate up to 32k pieces of
  state. It now caps pieces per message (1024), bytes per message (4 MiB),
  concurrent partial messages (32) and still evicts stale entries.
- Heartbeat writes to a single invite row let a large fleet exhaust the DB pool
  (a DoS-ish availability bug, found by the load test): throttled to 1/min.
- Concurrent approvals could collide on the address/DNS unique indexes: they
  are now queued per network.
- Import parsing errors were 500s; malformed TOML/links now return 400 with the
  parser message, and device RPC failures return 409.

Still accepted/known:

- `machine_id` is self-reported; approval is the security boundary.
- `X-Forwarded-*` is trusted only with `EASYPLANE_TRUST_PROXY=true`; do not
  enable it when the server is directly reachable.
- One organisation per deployment; roles are deployment-wide.
- EasyTier ACLs are destination-only and source IPs are spoofable unless
  `strictTags` is on (POLICY.md §6).
- The browser stream is same-origin and cookie-authenticated; there is no
  per-network read permission because a single deployment has one organisation.

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
