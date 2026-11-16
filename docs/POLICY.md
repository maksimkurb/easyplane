# Policy, MagicDNS and routes (M2)

Everything in this document was derived from the pinned EasyTier commit
`81487c363a56779e745eae927e130a813535c71e` (`easytier-proto/proto/acl.proto`,
`easytier-core/src/peers/acl/{filter,processor}.rs`,
`easytier-core/src/config/{api_input,toml,peers}.rs`,
`easytier-core/src/peers/{context,route/peer_ospf_route}.rs`,
`easytier-core/src/management/full/{process_rpc,instance_info}.rs`,
`easytier/src/instance/dns_server/**`, `easytier/src/core.rs`).

Claims are labelled:

- **[verified]** — exercised against real `easytier-core 2.6.4-81487c36`
  containers in `test/conformance/m2.test.ts`.
- **[source]** — read from the pinned sources and covered by unit/golden tests,
  but not exercised end-to-end.

## 1. Why a compiler at all

EasyTier's ACL is a packet filter with three chains per instance
(`acl.proto`, `ChainType`): `Inbound` (destination is this node), `Outbound`
(packet leaves this node) and `Forward` (packet transits this node). Rules carry
`priority` (higher first), `protocol`, `ports` (destination), `source_ips`,
`destination_ips`, `source_ports`, `source_groups`, `destination_groups`,
`action`, `rate_limit`, `burst_limit`, `stateful`.

That is expressive but per-device and address-oriented, exactly the wrong shape
for humans. EasyPlane keeps a Tailscale-shaped **policy document** as the single
source of truth and **compiles it per device** into those chains:

```
policy document (per network, append-only versions)
   + approved devices, tags, owners/IdP groups, approved subnet routes
   -> compile(device) -> acl.Acl embedded in that device's NetworkConfig
   -> revision (policy_version) -> push -> client AclFilter
```

Consequences that are real, not cosmetic:

- the compiled ACL is part of the pushed config, so it is **revisioned**:
  a policy save creates a revision for every approved device with
  `policy_version = N` (`source = policy`); rolling a device back also restores
  the policy version it was compiled with;
- nothing secret is stored in revisions: EasyTier **group secrets are derived**
  with `HMAC-SHA256(EASYPLANE_ENCRYPTION_KEY, "easyplane.acl-group" || networkId
  || tag)` and only exist in the pushed config;
- a device only enforces what its chain says. Policy changes on the server do
  nothing to an offline device until it reconnects and is pushed;
- revisions created before M2 (`policy_version = null`) follow the network's
  active policy; revisions created by M2 pin the version they were compiled
  with, so rolling a device back restores that ACL too. Disabling the policy
  creates revisions with `policy_version = 0` (no ACL pushed at all).

## 2. The document

JSON or HuJSON (`//`, `#`, `/* */` comments and trailing commas are accepted):

```jsonc
{
  "version": 1,
  "groups": {
    // "group:<name>" -> user emails and/or IdP group names
    "group:ops": ["bob@example.com", "engineering"]
  },
  // Informational; the panel enforces ownership when tags are assigned.
  "tagOwners": { "tag:db": ["group:ops"] },
  // Static aliases for addresses that are not EasyPlane devices.
  "hosts": { "nas": "192.168.50.10" },
  "options": { "strictTags": false },
  "acls": [
    { "name": "ops-ssh", "action": "accept", "src": ["group:ops"],
      "dst": ["*:22"], "proto": "tcp" },
    { "name": "web-db", "action": "accept", "src": ["tag:web"],
      "dst": ["tag:db:5432"], "proto": "tcp", "stateful": true,
      "rateLimit": 200, "burst": 100 },
    { "name": "web-nas", "action": "accept", "src": ["tag:web"],
      "dst": ["cidr:192.168.50.0/24:445"], "proto": "tcp" },
    { "name": "no-lab", "action": "deny", "src": ["tag:web"],
      "dst": ["host:nas:23"] }
  ]
}
```

Subjects:

| subject | matches |
| --- | --- |
| `*`, `autogroup:all` | every approved device in the network |
| `tag:<name>` | devices carrying that tag |
| `group:<name>` | devices owned by users matching `groups["group:<name>"]` (email or IdP group) |
| `device:<dns-name>` / bare `<dns-name>` | one device by its unique DNS name |
| `host:<alias>` | `hosts[alias]` (IPv4 or CIDR), not a device |
| `cidr:<v4>/<prefix>` | raw CIDR (destinations and forward sources) |

Destinations take an optional port list: `tag:db:5432`, `*:80,443`,
`tag:web:8000-8100`, or `*`/no suffix for every port. `proto` is `any` (default),
`tcp`, `udp` or `icmp`. `rateLimit` requires a non-zero `burst` (EasyTier would
start with an empty bucket and drop everything; validation rejects it).

Validation is strict where an operator types a name (unknown tags/groups/
devices, malformed subjects, port ranges, duplicate statement names, undefined
host aliases, overlapping CIDRs) and lenient at push time (a tag can be deleted
between two pushes; the compilation then skips it and records a warning instead
of wedging the network).

## 3. Compilation

Per device `D`:

| chain | default | rules emitted |
| --- | --- | --- |
| `Inbound` | **Drop** | every `accept` statement whose destination resolves to `D`: `source_ips` = resolved source devices/CIDRs, `ports` = the statement's destination ports, `protocol`, `action = Allow`, `rate_limit`/`burst_limit`/`stateful` |
| `Outbound` | Allow | explicit `deny` statements where `D` is a source: `destination_ips` = the resolved destinations, `action = Drop` |
| `Forward` | **Drop** (only present when `D` serves an approved subnet route) | `accept` statements whose destination is a CIDR covered by `D`'s approved routes: `source_ips` = sources, `destination_ips` = the CIDR |

`priority = 65535 - <statement index>`, so document order is match order
(highest priority first, first match wins — `processor.rs` sorts by
`Reverse(priority)` and returns on the first match). Deny rules only need to
exist where the chain default would otherwise allow the flow, which is why they
appear in `Outbound` only: `Inbound` already defaults to `Drop`.

`destination_ips` is left empty in the inbound chain: the packet already arrived
at this node, and the port criterion is what distinguishes services. (`Inbound`
is classified by `filter.rs::classify_chain_type` when the destination is the
node's own virtual IP.)

Group declarations (`acl.group`):

- `declares` = the tag names whose secrets this config carries;
- `members` = the subset that is this device's own tags.

With `options.strictTags` the compiler also adds `source_groups = ["tag:x"]` to
allow rules whose source is a tag, and declares those tags' secrets on the
destination so EasyTier can verify the sender's `group_proof`
(`peer_ospf_route.rs` verifies HMACs with the local group secret). See §6.
[verified] — a strict-tag policy keeps the allowed flow working on real clients,
which requires the proof to verify.

## 4. Tailscale construct -> EasyTier primitive

| Tailscale | EasyPlane / EasyTier | Status |
| --- | --- | --- |
| `tag:name` on devices | EasyTier group `tag:name` (declared with a derived secret; device is a `member`); rule matching uses enumerated `/32` source IPs, optionally plus `source_groups` | **approximated** (group membership is an HMAC over the peer id, not a control-plane signature; a verifier must hold the secret) |
| `tagOwners` | Stored in the document, enforced by panel permissions when tags are assigned | clean (UI-level) |
| `group:name` of users | Devices owned by users whose email/IdP group matches; device ownership is a panel concept | **approximated** (EasyTier has no user identity on the wire; only devices are subjects) |
| `autogroup:all`, `*` | every approved device | clean |
| `hosts` aliases | `cidr:` in the compiled rules | clean |
| ACL statement order / first match | rule `priority` = document order, first match wins | clean |
| `dst` ports and ranges | `ports` string list | clean |
| protocol (`tcp`/`udp`/`icmp`) | `acl.Protocol` | clean (EasyTier also has `ICMPv6`) |
| `accept` | `Action.Allow` in the destination's inbound chain | clean |
| `deny` | `Action.Drop` (silent drop, no RST) for egress denials; destination-side denials fall out of default-Drop | clean, but a `deny` never produces an ICMP/RST error |
| rate limiting | `rate_limit` + `burst_limit` (token bucket per rule) | clean |
| connection tracking / `stateful` | `stateful` flags a rule and records the flow in `conn_track`; it does **not** implement "established/related" matching | **approximated**: set it for visibility only; replies are allowed by `outbound_allow_records` (see below) |
| `dst` = `0.0.0.0/0` (exit node egress) | `enable_exit_node` on the exit node; `exit_nodes` on clients; ACL filtering would have to happen in the exit node's `Forward` chain | **approximated** (panel manages the approval, not a per-client egress matrix) |
| subnet routes (`--advertise-routes`) | approved `device_routes` -> `proxy_cidrs` on the router; `routes` + `enable_manual_routes` on clients that accept routes; `Forward` chain | **approximated** (explicit approval instead of Tailscale's auto-approvers; forward chain is default-drop, so a `cidr:` statement is required to use the route) |
| device posture, app connectors, tailnet lock, node attributes, SSH, auto-approvers, `grant` | — | **unsupported** (no equivalent primitive) |
| ACL tests / "can A reach B" | evaluator over the compiled ACL (same matcher), plus an unsaved-document preview | clean (M2) |
| MagicDNS zones/records | per-network switch + names; zone is a client-side flag (see §5) | **partially unsupported** (zone cannot be pushed) |
| managed credentials (`ManagedCredentialConfig`) | nothing yet; EasyPlane enrols everything through invites | **unsupported in M2** (credentials are for instances that join without the network secret; issuing them is an M4 import/credential feature) |

### What is genuinely enforced [verified]

`test/conformance/m2.test.ts` runs three real clients. With the policy

```jsonc
{ "acls": [{ "name": "clients-to-web", "action": "accept",
             "src": ["tag:client"], "dst": ["tag:web:8080"], "proto": "tcp" }] }
```

- the destination's pushed config carries the chain (`default_action = Drop`,
  rule `clients-to-web-in`) and the client logs
  `ACL rules built: 1 inbound, 0 outbound, 0 forward`;
- `curl http://<web>:8080` from both clients returns 200;
- `curl http://<web>:8081` times out and exits non-zero (the packet is dropped
  at the destination, not reset);
- the web device cannot reach a client at all (no statement, default drop);
- saving the same policy with `options.strictTags: true` adds
  `sourceGroups = ["tag:client"]` to the destination rule and the allowed flow
  still returns 200, i.e. EasyTier verified the sender's group proof with the
  declared secret (a wrong/missing secret would fail the proof and drop the
  packet). [verified]

## 5. MagicDNS

Facts from the sources:

- `NetworkConfig.enable_magic_dns` is mapped to `flags.accept_dns`
  (`api_input.rs:485`) and `new_from_config` reports it back.
- The DNS server (`dns_server/server_instance.rs`) answers
  `<hostname>.<tld_dns_zone>` with each peer's virtual IPv4, builds the zone
  from `flags.tld_dns_zone` (default `et.net.`), and every peer's hostname
  becomes a record (`update_dns_records`).
- `tld_dns_zone` exists only in `FlagsInConfig` / CLI `--tld-dns-zone`. There is
  **no** field for it in `NetworkConfig`, and `gen_config` builds flags from
  defaults. [source]

Therefore:

- EasyPlane implements the *network* switch: when enabled, every pushed config
  sets `enable_magic_dns = true` (per-device overrides are ignored; the network
  is the single switch). [verified — `dig +short core-a.et.net @100.100.100.101`
  on a client returns the peer's virtual IP]
- Names are `<unique-dns-name>.<network zone>`. Uniqueness is enforced in the
  service (sanitise, then `-2`, `-3`, …) and by a unique index on
  `lower(dns_name)` per network; renaming uses
  `PUT /api/devices/:id/hostname` and is pushed as the EasyTier hostname.
- The **zone** is a naming/UI setting. A config-server-managed instance always
  serves `et.net.`, because the zone cannot be pushed. The panel warns when a
  network zone differs from `et.net.` and tells the operator the client-side
  `--tld-dns-zone <zone>` flag that a *locally run* instance would need.
  Claiming otherwise would be dishonest.
- EasyTier clients configure their system resolver only where the platform
  allows it; in containers `/etc/resolv.conf` was left untouched, so the
  conformance assertion queries the resolver's fake IP `100.100.100.101`
  directly (the same address the client would be told to use).
- Duplicate hostnames from clients are resolved at approval time (suffix), so
  two devices can never own the same DNS name; the reported client hostname is
  kept for display and shown as "renamed" when it differs.

## 6. Security notes and limits

- **IP-based matching is spoofable by a malicious peer.** EasyTier does not
  verify that the source IP inside a data packet belongs to the sending peer.
  A member that can send overlay packets can forge a source address and pass
  an IP rule. `options.strictTags` adds EasyTier's group proof (HMAC over the
  peer id) for tag sources, which closes that hole for those rules — at the
  cost of giving the verifier the tag secret, so a compromised destination can
  impersonate that tag. Neither variant is as strong as Tailscale's
  control-plane-signed tags. Choose per network; the default is IPs only for
  determinism (and because group sync must have converged before traffic
  flows).
- **Group secrets are derived, not stored.** Rotating
  `EASYPLANE_ENCRYPTION_KEY` changes every group secret; the next push updates
  them. Losing the key makes existing configs unverifiable until re-push.
- **The outbound chain defaults to allow.** EasyTier has no "allow established"
  state for the outbound direction; a default-drop egress chain would also drop
  a server's responses to an allowed inbound request. Egress is therefore only
  restricted by explicit `deny` statements (and by the destination's inbound
  policy). [source; consistent with `filter.rs` `outbound_allow_records`]
- **Deleting a tag or device does not rewrite history.** Old policy versions
  and revisions keep their content; compilation at push time resolves current
  names and warns about missing ones.
- **No policy = no ACL.** With `policy_version = 0` the config carries no
  `acl`, EasyTier's filter is disabled and every device can reach every other
  device on every port. The panel says so explicitly. An empty document is
  different: it denies everything inbound.
- **Rules are per destination device.** A statement `tag:web -> tag:db:5432`
  materialises on `db` (and on `web` only if a deny is needed). A device that
  is offline keeps its old chain until it reconnects.

## 7. Subnet routes and exit nodes

Workflow:

1. A member (or admin) requests `subnet 192.168.77.0/24` or `exit_node` for a
   device (`POST /api/devices/:id/routes`). Subnet requests are validated
   (IPv4 CIDR with prefix 0-32, no overlap with the overlay or other requests;
   `0.0.0.0/0` is rejected — use the exit-node kind). **pending**. Such a row has
   `source = panel`.
2. A device can instead **declare** its own routes in its persisted config
   (see §7.1). The panel turns the declaration into a pending row with
   `source = device_declared`. Both sources share one table and the same
   decision endpoint; a unique index on `(device, kind, cidr)` means a repeated
   report never duplicates a row and a rejection is never resurrected.
3. Only an admin approves or rejects (`POST /api/routes/:id/decision`). Every
   decision is audited and pushes **every approved device in the network**
   (receivers' manual-route lists depend on the approval set).
4. The compiler/push path maps approvals:
   - `subnet` approved -> `proxy_cidrs` on that device [verified: the client's
     `GetNetworkInstanceConfig` reports the CIDR];
   - `exit_node` approved -> `enable_exit_node = true` [verified: reported back
     and peers see the exit node];
   - every device gets `enable_manual_routes = true` and
     `routes = [every other approved subnet]` when it accepts routes, or
     `routes = []` when it does not. An unapproved advertisement is therefore
     never installed on a receiver [verified — with an empty list the CIDR is
     absent from `ip route` and unreachable; with the approved list it is
     present and reachable].
5. Reported routes:
   - `GetNetworkInstanceConfig` gives the device's own configured
     `proxy_cidrs` (what EasyPlane pushed, including a pending declaration) and
     `enable_exit_node`;
   - `CollectNetworkInfo` route entries list **peers only** — upstream skips
     the local peer id (`peer_ospf_route.rs::list_routes`), so the panel cannot
     read a device's own advertisement from that device;
   - reports combine the device's own config with what **other members** see it
     advertising (attributed per device, plus `unknownPeers` for addresses that
     are not managed devices).

What can and cannot be revoked:

| situation | detection | revocation |
| --- | --- | --- |
| managed instance advertises an unapproved CIDR (drift, manual RPC) | own config + peer reports | yes: the next push replaces `proxy_cidrs`; `DeleteNetworkInstance` stops it while online |
| a device **declares** a route in its persisted config | its own `GetNetworkInstanceConfig` (primary), peers (secondary, CIDR only) | it becomes a pending proposal; while pending the panel **adopts** it (pushes it back) instead of erasing it. Reject -> one push restores the desired state (config-dir file) and the route is never distributed to receivers |
| an extra instance inside the managed easytier-core process advertises a route | peers report an `unknownPeer` (or a known device with extra CIDRs) | only while the device is online (`DeleteNetworkInstance`); the panel cannot delete it on an offline device, and a *foreign `instance_id`* is not attributed to the device at all |
| a **separate easytier-core process** started from a local file/CLI on the same host | **not detectable at all** — the control plane only sees the process connected as its config-server client | no; it must be changed on the device. `config_permission` is `READ_ONLY|NO_DELETE` for file-backed instances, so even the managed process would refuse to modify its own file-based instance |
| a read-only (`-c`, mode 0444) instance file | `ListNetworkInstanceMeta` reports `config_permission` with the READ_ONLY bit; the own-config read is refused | no: the panel cannot read or overwrite it. It is a **state** ("configuration is managed locally"), not a push error; nothing is retried and no `push_failed` audit is written |
| offline device | last report is stale (`collectedAt`) | no; it keeps the last pushed config until it reconnects |

The conformance test creates a second, non-managed instance inside a client's
managed process advertising `172.31.0.0/16`; the panel flags it as
`unknownPeers` with `unapprovedObservedCidrs` and audits
`route.unapproved_reported`. [verified]

### 7.1 Device-declared routes (implemented)

A Tailscale-like path where the device itself is the source of truth for what it
routes. It uses **one** managed instance per device, run with `--config-dir`:

```
easytier-core --config-server wss://panel/<token> --config-dir /var/lib/easytier-client
```

The client persists the pushed `NetworkConfig` as
`<config-dir>/<instance-id>.toml` (atomic, mode `0600`). The operator stops the
client, adds `[[proxy_network]] cidr = "…"` and/or `enable_exit_node = true`,
and starts it again. Findings that shape the implementation (measured on the
pinned client, `test/conformance/declared-routes.test.ts`):

- the persisted file is reloaded on start and the declaration is visible in
  `GetNetworkInstanceConfig` (`proxyCidrs`, `enableExitNode`) [verified];
- the managed file is `EDITABLE|DELETABLE`; an external read-only `-c` file is
  refused **and its config cannot even be read**, and the refusal is retried on
  every heartbeat unless the panel classifies it [verified];
- peers see the declared CIDR on the device's own overlay IP (attributable, no
  `unknownPeer`), but never the exit-node flag [verified];
- `enable_manual_routes` with an empty `routes` list installs nothing; without
  it, every advertised proxy CIDR is installed automatically [verified +
  source: `resolve_proxy_cidrs` in `gateway/proxy/cidr_monitor.rs`];
- the pinned client's `network_config_from_toml` reports
  `enable_manual_routes` only when the list is **non-empty**, so an empty manual
  list reads back as "flag absent, `routes: []`" [source; the panel's drift
  comparison accounts for it];
- a receiver never uses an exit node without `exit_nodes`, and even with
  `exit_nodes` it needs an OS route into the tunnel [verified].

Implemented semantics:

1. **Detection.** After a drifted/periodic read of the managed instance's own
   config, any `proxy_cidrs` / `enable_exit_node` that is not an approved or
   known route becomes a pending `device_declared` row (`route.declared` audit,
   once per row). `0.0.0.0/0` and CIDRs that contain or sit inside the overlay
   are not turned into proposals (they stay visible as unapproved drift).
2. **Adoption while pending.** Every push to the device includes its pending
   *and* approved declared routes in its own `proxy_cidrs`/`enable_exit_node`,
   so the 15 s reconciler cannot erase the operator's edit. Receivers still get
   only **approved** routes. Because the panel re-asserts a pending
   declaration, a device that is online and pushed keeps advertising it; only
   a device that stops reporting (offline, read-only file, foreign instance id)
   can make it disappear.
3. **Decisions.** `POST /api/routes/:id/decision` is unchanged. Approving a
   declared subnet adds it to the advertiser's `proxy_cidrs` and to every
   accepting device's `routes`; rejecting it removes it from the advertiser on
   the next push (config-dir file) and never distributes it.
4. **Staleness.** `device_routes.last_declared_at` is refreshed by each report
   that still shows the declaration. Older than five minutes (or never seen)
   sets `advertised: false` in the API; the UI shows "no longer advertised".
   Rows are never auto-withdrawn or deleted, and approvals are not reverted.
5. **Read-only files.** A `READ_ONLY` `config_permission` is persisted as a
   device state (`configManagedLocally`), skipping pushes without setting
   `lastPushError`; the panel refreshes the permission when the file becomes
   writable again. Only peer observations remain as a detection signal in that
   mode (CIDR, no exit flag).
6. **Exit nodes are consent only.** The panel never pushes `exitNodes` to a
   client and never sets `enable_exit_node` on an advertiser for a *declared*
   exit node (it is already local). The badge distinguishes "proposed" from
   "approved". Actual egress needs the client's own `exit_nodes` setting plus an
   OS route into the TUN; docs/DEPLOY.md §4b has the OpenWrt recipes.
7. **File identity matters.** Renaming `<instance-id>.toml` keeps the same
   instance id and a push overwrites the renamed file in place (`NO_DELETE`
   only). Changing `instance_id` makes the panel create a second instance; the
   foreign one is not attributed and its CIDR shows up as an `unknownPeer`
   [verified]. Keep the file name and id.

The panel-side request flow (`source = panel`) is unchanged and still useful for
a device that cannot edit its own config.

## 8. API surface

| endpoint | role | purpose |
| --- | --- | --- |
| `GET /api/networks/:id/policy` | any | active version + document |
| `GET /api/networks/:id/policy/versions` | any | append-only history |
| `POST /api/networks/:id/policy/validate` | admin | validate a document/text, warnings + compiled summary per device |
| `PUT /api/networks/:id/policy` | admin | save `{document}` or `{text}` (HuJSON), creates revisions |
| `DELETE /api/networks/:id/policy` | admin | disable the policy (ACL filter off) |
| `POST /api/networks/:id/policy/preview` | member/admin | "can A reach B on port P" for an unsaved document (`document` or HuJSON `text`) |
| `POST /api/networks/:id/policy/test` | member/admin | same against the saved policy |
| `GET /api/networks/:id/dns` | any | switch, zone, resolved names/IPs |
| `PUT /api/devices/:id/hostname` | member/admin | rename (unique per network) |
| `GET /api/tags`, `POST /api/tags` | any / admin | policy tag list/create |
| `PUT /api/devices/:id/tags` | member/admin | assign tags |
| `PUT /api/devices/:id/owner` | admin | owner for `group:` subjects |
| `GET /api/networks/:id/routes` | any | requests, approvals, reports (`source`, `lastDeclaredAt`, `advertised` per row) |
| `GET/POST /api/devices/:id/routes` | any / member+ | list / request (`source = panel`) |
| `POST /api/routes/:id/decision` | admin | approve/reject; pushes every approved device |

Audit actions: `policy.version_created`, `policy.disabled`, `tag.created`,
`device.tags_updated`, `device.renamed`, `device.owner_updated`,
`network.magicdns_updated`, `route.requested`, `route.declared`,
`route.approved`, `route.rejected`, `route.unapproved_reported`. No group
secret, network secret or token is ever written to the audit log
(`sanitizeAuditMetadata` strips secret-looking keys, and the compiler never hands
secrets to it).

## 9. Known gaps (M2)

- Per-client exit-node selection is not managed: approving a declared exit node
  records consent but the panel never pushes `exitNodes`, so egress still needs
  the client's own setting and OS route.
- A read-only instance file cannot be read by the control plane (upstream
  refuses `GetNetworkInstanceConfig`), so a declaration there is invisible
  except as a peer-observed CIDR; the exit-node flag cannot be detected at all.
- A foreign `instance_id` (renamed file or a second instance) is not attributed
  to the device; it appears as an `unknownPeer`.
- Users cannot request routes for themselves (there is no per-user login on a
  device); a member asks on the device's behalf.
- No auto-approvers (CIDR allow-lists) for route requests.
- Managed credentials, device posture, SSH and `grant` syntax are not
  implemented (see the table in §4).
- `stateful` does not filter by connection state; only `outbound_allow_records`
  lets replies through.
- Policy compilation is O(devices × statements) per push and each push is one
  `RunNetworkInstance` per device; a few hundred devices are fine, a large
  fleet needs batching (M4).

## 10. Appendix: one compiled ACL, end to end

Policy:

```jsonc
{ "acls": [{ "name": "web-db", "action": "accept",
             "src": ["tag:web"], "dst": ["tag:db:5432"], "proto": "tcp" }] }
```

Devices: `web` = 10.10.0.2 (`tag:web`), `db` = 10.10.0.4 (`tag:db`).

`db`'s compiled `NetworkConfig.acl` (this is what `RunNetworkInstance` carries;
`acl.Protocol` 1 = TCP, `Action` 1 = Allow, 2 = Drop, `ChainType` 1/2/3 =
Inbound/Outbound/Forward):

```json
{
  "aclV1": {
    "chains": [
      {
        "name": "easyplane-inbound",
        "chainType": 1,
        "description": "Destination-side policy enforcement (default drop)",
        "enabled": true,
        "rules": [
          {
            "name": "web-db-in",
            "description": "accept tag:web -> db (inbound) (tag:db:5432)",
            "priority": 65535,
            "enabled": true,
            "protocol": 1,
            "ports": ["5432"],
            "sourceIps": ["10.10.0.2/32"],
            "destinationIps": [],
            "sourcePorts": [],
            "action": 1,
            "rateLimit": 0,
            "burstLimit": 0,
            "stateful": false,
            "sourceGroups": [],
            "destinationGroups": []
          }
        ],
        "defaultAction": 2
      },
      {
        "name": "easyplane-outbound",
        "chainType": 2,
        "description": "Explicit egress denies only (default allow)",
        "enabled": true,
        "rules": [],
        "defaultAction": 1
      }
    ],
    "group": {
      "declares": [{ "groupName": "tag:db", "groupSecret": "<derived, never stored>" }],
      "members": ["tag:db"]
    }
  }
}
```

With `options.strictTags` the same rule additionally carries
`"sourceGroups": ["tag:web"]` and `db`'s group block declares `tag:web` too (so
it can verify the proof). Golden tests for these shapes live in
`apps/server/test/unit/policy-compiler.test.ts`.
