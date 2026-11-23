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
(packet leaves this node) and `Forward` (packet transits this node, including
the userspace subnet proxy). Rules carry `priority` (higher first), `protocol`,
`ports` (destination), `source_ips`, `destination_ips`, `source_ports`,
`source_groups`, `destination_groups`, `action`, `rate_limit`, `burst_limit`,
`stateful`.

That is expressive but per-device and address-oriented, exactly the wrong shape
for humans. EasyPlane keeps one **policy document** (version 2) per network as
the single source of truth and **compiles it per device** into those chains:

```
policy document v2 (per network, append-only versions)
   + approved devices, tags (device labels), user groups (people),
   + approved subnet routes
   -> compile(device) -> acl.Acl embedded in that device's NetworkConfig
   -> revision (policy_version) -> push -> client AclFilter
```

The document has three modes (`mode`):

| mode | effect |
| --- | --- |
| `open` | no ACL is pushed; EasyTier's filter is off. The document is still stored. |
| `rules` | the structured editor; rules compile per device. |
| `json` | the very same document edited as HuJSON; edits show up as rules. |

Consequences that are real, not cosmetic:

- the compiled ACL is part of the pushed config, so it is **revisioned**:
  a policy save creates a revision for every approved device with
  `policy_version = N` (`source = policy`); rolling a device back also restores
  the policy version it was compiled with;
- nothing secret is stored in revisions: EasyTier **group secrets are derived**
  with `HMAC-SHA256(EASYPLANE_ENCRYPTION_KEY, "easyplane.acl-group" || networkId
  || <group name>)` and only exist in the pushed config. Tag groups are named
  `tag:<name>`, user groups `group:<name>`;
- a device only enforces what its chain says. Policy changes on the server do
  nothing to an offline device until it reconnects and is pushed;
- revisions created before M2 (`policy_version = null`) follow the network's
  active policy; revisions created by M2 pin the version they were compiled
  with. Switching the mode to `open` creates revisions with
  `policy_version = 0` (no ACL pushed at all).

## 2. The document (version 2)

JSON or HuJSON (`//`, `#`, `/* */` comments and trailing commas are accepted):

```jsonc
{
  "version": 2,
  "mode": "rules",                       // open | rules | json

  // Named subnets: approved subnet routes, usable as source and destination.
  "subnets": {
    "home-lan": { "cidr": "192.168.55.0/24", "via": "router-01" }
  },

  // Tags label DEVICES (not people).
  "tags": { "us": ["laptop-maxim"], "home": ["desktop", "router-01", "nas-01"] },

  // User groups are PEOPLE: manual members by email, or a synced IdP claim
  // value (read-only). They match the devices those people own.
  "userGroups": {
    "admins": { "source": "manual", "members": ["maxim@home.example"] },
    "family": { "source": "oidc", "members": ["anna@home.example"] }
  },

  // Static aliases for addresses that are not EasyPlane devices.
  "hosts": { "nas": "192.168.50.10", "v6": "2001:db8::10" },

  // Informational; the panel enforces ownership when tags are assigned.
  "tagOwners": { "tag:db": ["group:admins"] },

  // Per-chain defaults. `enabled: false` means the chain is NOT emitted (see
  // §3: EasyTier keeps a disabled chain's default action, so we omit it).
  "chains": {
    "inbound":  { "default": "block", "enabled": true, "name": "Inbound" },
    "outbound": { "default": "allow", "enabled": true },
    "forward":  { "default": "block", "enabled": true, "name": "Forward" }
  },

  "options": { "strictTags": false, "strictGroups": false },

  // Ordered: list order is match order (priority = 65535 - index).
  "rules": [
    { "name": "Family media", "action": "allow",
      "from": ["group:family"], "to": ["device:media-pc"],
      "protocol": "tcp", "ports": ["8096", "32400"], "enabled": true },
    { "name": "LAN to VPS", "action": "allow",
      "from": ["subnet:home-lan"], "to": ["device:vps-fra"],
      "protocol": "any" },
    { "name": "Block SSH to NAS", "action": "deny",
      "from": ["*"], "to": ["device:nas-01"], "protocol": "tcp", "ports": ["22"] }
  ]
}
```

### Rule fields

| field | meaning |
| --- | --- |
| `name` | optional label; non-empty names must be unique, empty names are fine |
| `enabled` | default `true`; a disabled rule is not compiled anywhere |
| `action` | `allow` or `deny` |
| `from` / `to` | lists of subjects (see below) |
| `protocol` | `any` (default), `tcp`, `udp`, `icmp`, `icmpv6` |
| `ports` | destination ports and ranges (`"443"`, `"8000-8100"`); empty = any. Rejected for explicit ICMP/ICMPv6 |
| `sourcePorts` | optional source port list/range; empty = any |
| `stateful` | default **true**. EasyTier records the flow; it is not an established/related match (see §3) |
| `rateLimit` + `burst` | token bucket (packets/s). `burst` is required when `rateLimit` is set, otherwise the bucket starts empty and drops everything |

Deliberately **not** in the document: `description` (derived), `priority`
(list order always wins) and `chain` (the compiler derives the placement).

### Subjects

| subject | matches |
| --- | --- |
| `*`, `anyone`, `anywhere`, `autogroup:all` | every approved device |
| `tag:<name>` | devices carrying that label |
| `group:<name>` | devices owned by the people in that user group |
| `subnet:<alias>` | the CIDR of `subnets[alias]` (an approved route); covers hosts behind the router, e.g. `192.168.55.16` |
| `device:<dns-name>` / bare `<dns-name>` | one device by its unique DNS name |
| `host:<alias>` | `hosts[alias]` (IPv4/IPv6 address or CIDR), not a device |
| `cidr:<IPv4/IPv6 CIDR>` | a raw CIDR (destinations and forward sources; IPv6 passes through) |

Tags and user groups are **distinct concepts**: tags label devices, user groups
contain people. They are separate collections, separate subject kinds and
compile to differently namespaced EasyTier groups (`tag:` / `group:`).

### Validation

Strict where an operator types a name (unknown tags/groups/devices/subnets/
hosts, malformed subjects, invalid ports/ranges/CIDRs, duplicate non-empty rule
names, `rateLimit` without `burst`) and lenient at push time (a tag or device
can disappear between two pushes; compilation then skips it and records a
warning instead of wedging the network). Ports are 1–65535 and a range must go
from low to high. IPv4 and IPv6 are both accepted.

### v1 compatibility and migration

Existing version-1 documents (`acls`, `accept`/`deny`, `src`/`dst` with a
`:port` suffix, `groups`) still load, validate and compile. They are upgraded
to v2 automatically on save: `accept` → `allow`, the destination port suffix →
`ports`, `groups` → `userGroups` (manual members), `proto` → `protocol`, and
the v1 fixed chain defaults (inbound block, outbound allow, forward block).
The API reports `upgradedFromV1: true`. Nothing is deleted; a v1 `group:ops`
keeps resolving through the upgraded group.

Tags live in the `tags`/`device_tags` tables, user groups in
`user_groups`/`user_group_members`. A document's `tags` and `userGroups`
sections are applied on save (bulk device assignment / manual membership) and
are always filled in on read, so JSON mode reflects the real state.
`source: "oidc"` groups are read-only: their members are derived from the
`groups` claim of the users who signed in.

## 3. Compilation

The translation is driven by measurements on the pinned client, not by reading
the filter in isolation. `test/conformance/policy-spike.test.ts` runs three
real clients plus a **LAN host behind a subnet router** (a separate container
whose only route into the overlay is the router's TUN) and a final end-to-end
case that saves a v2 policy through the API and asserts both directions work.

### 3.1 SPIKE results (all [verified] on `2.6.4-81487c36`)

| question | measured result |
| --- | --- |
| `A -> B tcp` with only a B inbound allow; both defaults drop | **works** with `stateful:false` and `stateful:true`. The reply is admitted by `outbound_allow_records`: a node remembers the 5-tuple of an **allowed outbound** packet for 30 s and lets the matching inbound packet through even if the inbound chain drops it. `stateful` only records the flow. |
| same for ICMP | **works** with an inbound allow for `protocol: ICMP`; without it the echo request is dropped at the destination. |
| same for UDP | **works**; the reply matches the sender's outbound record. |
| does a sender's `Outbound` default Drop matter | **yes.** With no outbound rule the request is dropped at the sender and no record exists, so the reply could not be admitted either. An explicit outbound allow restores the flow. |
| what default applies when a chain is missing | **Allow** for that direction (`build_default_actions` falls back to Allow). An *empty* chain with `default_action: Drop` drops everything. |
| `Chain.enabled: false` | removes the chain's **rules only**; its `default_action` is still used. A disabled drop chain still drops. `enabled:false` is therefore not "disable": the compiler omits the chain instead. |
| LAN host (192.168.55.16) -> remote B | **works** with a B inbound allow whose `source_ips` is the LAN IP/CIDR, and the router's **Outbound** default allow (the LAN packet leaves the router through its egress chain). B sees the **LAN IP** as the source (no NAT). The router's Forward default-drop does not block this direction; the reply is admitted by the router's outbound record. |
| remote B -> LAN host | decided by the router's **Forward** chain: EasyTier's userspace subnet proxy terminates the connection, so a default-drop Forward chain blocks it and a Forward allow (`source_ips` = B, `destination_ips` = LAN CIDR) is required. The LAN host sees the **router's LAN address** as the source (192.168.55.2 in the test), i.e. the proxy is a NAT at the router. |
| the proxy's return path | after proxying, the router sends the return traffic **itself**, addressed from its **own overlay IP** to the original client, with the proxy's ephemeral source port. This packet hits the router's **Outbound** chain and cannot be matched by the service port. The compiler therefore emits a peer-pair allow for it (`*-proxy-out`). |
| `source_groups` / `destination_groups` | match the peer's verified tag/group HMAC, not addresses. With both `source_ips` and `source_groups` set, **both** must match. A group-only rule admits a tagged peer; an address that matches while the group does not is dropped. |
| owner's bug | the model could not express the LAN host: tags/devices resolve to overlay `/32`s, so a rule naming the router or its tag never matched the LAN source at the destination. Policy v2's `subnet:` subject fixes that, and the compiler now also emits the router Forward/reply rules needed for the reverse direction. |

### 3.2 Translation rules (per device `D`)

| chain | what the compiler emits |
| --- | --- |
| **Inbound** (default block) | every enabled `allow`/`deny` whose destination resolves to `D`: `source_ips` = source device `/32`s + `cidr:`/`host:` + `subnet:` CIDRs; `ports`/`source_ports`/`protocol`; `source_groups`/`destination_groups` only with `options.strictTags`/`strictGroups`; `rate_limit`/`burst_limit`/`stateful` |
| **Outbound** (default allow) | for `allow`: an egress rule when the outbound default is **block** (or for a source subnet, on its router) so the flow leaves and creates the reply record. For `deny`: always, so a deny is explicit even in a default-allow chain. Plus **reverse** rules: the destination's replies (`*-reply-out`, `source_ports` = service ports) and the router's proxy return path (`*-proxy-out`) |
| **Forward** (default block, emitted for subnets) | destination subnet/CIDR covered by `D`'s approved routes: `destination_ips` = CIDR, `source_ips` = sources (main direction); plus `*-reply-fwd` for the return of a LAN-initiated flow (source = remote, destination = CIDR, `source_ports` = service ports) |

Priorities: explicit rules use `65535 - ruleIndex`, so document order is match
order (highest first, first match wins — `processor.rs` sorts by
`Reverse(priority)`). Reverse/convenience rules use a low band
(`1000 - index % 1000`), so an explicit `deny` anywhere in the document always
outranks a reply rule.

Group names are namespaced: `tag:<name>` for device labels, `group:<name>` for
user groups. Each device advertises its own memberships (its tags plus the user
groups of its owner) and holds the secrets it must verify (its own groups, plus
the source groups of rules when strict mode is on). With
`options.strictTags`/`strictGroups` a rule additionally carries
`source_groups`, so EasyTier verifies the sender's group proof (see §6).

**WireGuard portal clients are subjects too.** A client managed in the
WireGuard section (§16 in PROTOCOL.md) has an overlay `/32` and tags, so it
resolves from `tag:`/`device:`/`*` exactly like a device and its address is
compiled into the same inbound/egress rules. Because upstream rejects a portal
client whose `groups` are not declared by the hub's ACL, the compiler declares
the portal clients' tags on their hub and the pushed portal config only carries
declared groups (empty when the network has no ACL). Treat strict tag matching
for a portal client as unverified: it advertises the group, but the HMAC group
proof path was not exercised for portal peers; the default IP-based rules are
what the panel guarantees.

## 4. Tailscale construct -> EasyTier primitive

| Tailscale | EasyPlane / EasyTier | Status |
| --- | --- | --- |
| `tag:name` on devices | EasyTier group `tag:name` (declared with a derived secret; device is a `member`); rule matching uses enumerated source IPs, optionally plus `source_groups` | **approximated** (group membership is an HMAC over the peer id, not a control-plane signature; a verifier must hold the secret) |
| `tagOwners` | Stored in the document, enforced by panel permissions when tags are assigned | clean (UI-level) |
| `group:name` of users | EasyTier group `group:name`; devices owned by the people in the group declare the membership; rule matching uses enumerated source IPs, optionally plus `source_groups` | **approximated** (EasyTier has no user identity on the wire; only devices are subjects) |
| subnet routes as subjects | named `subnet:` subject → the CIDR, plus the router Forward/reply rules that make both directions work | clean (approval workflow; no auto-approvers) |
| `autogroup:all`, `*` | every approved device | clean |
| `hosts` aliases | `cidr:` in the compiled rules | clean |
| ACL statement order / first match | rule `priority` = document order, first match wins | clean |
| `dst` ports and ranges | `ports` string list | clean |
| protocol (`tcp`/`udp`/`icmp`) | `acl.Protocol` | clean (EasyTier also has `ICMPv6`) |
| `accept` | `Action.Allow` in the receive chain (and an egress/reply rule where a chain default would drop it) | clean |
| `deny` | `Action.Drop` (silent drop, no RST) on the source's Outbound chain and the destination's Inbound/Forward chain | clean, but a `deny` never produces an ICMP/RST error |
| rate limiting | `rate_limit` + `burst_limit` (token bucket per rule) | clean |
| connection tracking / `stateful` | `stateful` flags a rule and records the flow in `conn_track`; it does **not** implement "established/related" matching | **approximated**: replies rely on `outbound_allow_records` (30 s) or the compiler's explicit reverse rules |
| chain defaults / per-chain switch | document `chains.*` compiled into `Chain.default_action`; a disabled chain is omitted | clean |
| rule order | `priority = 65535 - index`; reverse rules in a low band | clean |
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

`test/conformance/policy-spike.test.ts` additionally runs a real LAN host
behind a real subnet router and finishes by saving a v2 policy through the API.
With **all three chains default-block**, a rule

```jsonc
{ "name": "lan-to-b", "action": "allow", "from": ["subnet:home-lan"],
  "to": ["device:core-sp-b"], "protocol": "tcp", "ports": ["8080"] }
```

makes the LAN host reach the remote node and a companion rule makes the remote
node reach the LAN host. The compiled ACL is asserted on the wire
(`lan-to-b-in` with `sourceIps = ["192.168.55.0/24"]` on the destination,
`b-to-lan-subnet-fwd` on the router's Forward chain, `lan-to-b-lan-out` and the
proxy return allow on the router's Outbound chain). An unrelated client on a
different `/32` is still denied. [verified]

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
- **The outbound chain defaults to allow**, but it can be switched to block.
  EasyTier has no "allow established" match; replies are admitted through
  `outbound_allow_records` (an allowed outbound 5-tuple lets the matching
  inbound packet through for 30 s). The compiler emits explicit reverse rules
  (`*-reply-out`, `*-reply-fwd`, `*-proxy-out`) so the flow also works with a
  default-drop egress chain or after a longer idle gap. [verified — §3.1]
- **Deleting a tag or device does not rewrite history.** Old policy versions
  and revisions keep their content; compilation at push time resolves current
  names and warns about missing ones.
- **No policy = no ACL.** With `policy_version = 0` the config carries no
  `acl`, EasyTier's filter is disabled and every device can reach every other
  device on every port. The panel says so explicitly. An empty document is
  different: it denies everything inbound.
- **Rules are translated, not copied.** `allow web -> db tcp 5432` materialises
  on `db`'s inbound chain, on `web`'s outbound chain when egress is filtered,
  and on a subnet router's forward chain when either side is a `subnet:`. The
  same statement's reply path is an explicit low-priority rule where a default
  would drop it. A device that is offline keeps its old chain until it
  reconnects.
- **The subnet proxy terminates TCP.** For `remote -> subnet`, the LAN host
  sees the router's LAN address, not the overlay source, and the router sends
  the return traffic itself from its overlay IP. The compiler emits a peer-pair
  allow (`*-proxy-out`) for that return path; it is scoped to the router and the
  original client but has no port criterion (the proxy's source port is
  ephemeral).
- **`enabled: false` on a chain means "omit it".** Do not send an EasyTier
  chain with `enabled: false` and expect it to be off: the default action still
  applies. [verified — §3.1]

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
| `GET /api/networks/:id/policy` | any | mode, active version + document, structured `rules` (index, name, enabled, action, protocol, ports, sourcePorts, stateful, rate/burst, structured `from`/`to` subjects with counts) and the summary |
| `GET /api/networks/:id/policy/versions` | any | append-only history |
| `GET /api/networks/:id/policy/subjects` | any | subject catalog for the pickers: devices, tags (device counts), user groups (people/device counts, `source`, `readOnly`), subnets (approved routes with their router) and hosts |
| `POST /api/networks/:id/policy/validate` | admin | validate a document/text (v1 is upgraded), warnings + compiled summary per device + `upgradedFromV1` |
| `PUT /api/networks/:id/policy` | admin | save `{document}` or `{text}` (HuJSON), optional `mode`; syncs the document's tags/user groups, creates revisions |
| `DELETE /api/networks/:id/policy` | admin | disable the policy (mode `open`, ACL filter off) |
| `POST /api/networks/:id/policy/mode` | admin | switch `open`/`rules`/`json`; `open` creates revisions with `policy_version = 0` |
| `GET /api/networks/:id/policy/compiled/:deviceId` | any | read-only compiled ACL for any device, in EasyTier field names (`chains[].defaultAction`, rules with `sourceIps`, `destinationIps`, `sourcePorts`, `sourceGroups`, `stateful`, …), group declarations without secrets |
| `POST /api/networks/:id/policy/preview` | member/admin | "can A reach B on port P" for an unsaved document; accepts a device **or a raw `srcIp`/CIDR**, returns a chain-by-chain `trace` and `decidedBy` |
| `POST /api/networks/:id/policy/test` | member/admin | same against the saved policy |
| `GET/POST /api/tags` | any / admin | tags (bare or `tag:` spelling); each row has `name`, `subject`, `deviceCount`, `devices` |
| `DELETE /api/tags/:id` | admin | delete a tag |
| `PUT /api/tags/:id/devices` | member/admin | bulk assign: exactly these devices carry the tag |
| `PUT /api/devices/:id/tags` | member/admin | assign tags to one device (kept for compatibility) |
| `GET/POST /api/user-groups` | any / admin | user groups: manual (`members`) or synced `oidc` (read-only, derived from the IdP `groups` claim), with people/device counts |
| `DELETE /api/user-groups/:id` | admin | delete a manual group (synced groups are read-only) |
| `POST /api/user-groups/:id/members`, `DELETE …/members/:email` | admin | manual membership |
| `PUT /api/devices/:id/owner` | admin | owner for `group:` subjects |
| `GET /api/networks/:id/routes` | any | requests, approvals, reports (`source`, `lastDeclaredAt`, `advertised` per row) |
| `GET/POST /api/devices/:id/routes` | any / member+ | list / request (`source = panel`) |
| `POST /api/routes/:id/decision` | admin | approve/reject; pushes every approved device |

Audit actions: `policy.version_created`, `policy.mode_changed`,
`policy.disabled`, `tag.created`, `tag.deleted`, `tag.devices_updated`,
`user_group.created`, `user_group.deleted`, `user_group.member_added`,
`user_group.member_removed`, `device.tags_updated`, `device.renamed`,
`device.owner_updated`, `network.magicdns_updated`, `route.requested`,
`route.declared`, `route.approved`, `route.rejected`,
`route.unapproved_reported`. No group secret, network secret or token is ever
written to the audit log (`sanitizeAuditMetadata` strips secret-looking keys,
and the compiler never hands secrets to it).

SSE events: `policy.updated` (with `mode`) after a save/mode switch/disable;
`tag.updated` and `user_group.updated` after collection changes. All invalidate
the `policy`/`devices` query topics.

## 9. Known gaps

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
- `stateful` does not filter by connection state. Replies work through
  `outbound_allow_records` (30 s) or the compiler's low-priority reverse rules;
  neither is an "established/related" match.
- The subnet proxy's return path is a peer-pair allow without a port criterion
  (`*-proxy-out`): it admits the router's proxy traffic to the original client
  on any port. It is scoped to that peer pair but broader than the service port.
- The synthetic `/api/…/policy/test` trace is best effort: it evaluates the
  compiled ACL chain by chain (source Outbound, destination Inbound, or the
  router's Forward for a CIDR) and cannot model the 30 s outbound records, the
  subnet proxy's internal sockets or routing failures. "Allowed" means "no ACL
  rule drops it", not "the OS routes it".
- Policy compilation is O(devices × statements) per push and each push is one
  `RunNetworkInstance` per device; a few hundred devices are fine, a large
  fleet needs batching (M4).
- IPv6 subjects and hosts validate and pass through, but subnet routes are
  IPv4-only (upstream `proxy_cidrs` handling and the approval workflow), so an
  IPv6 `subnet:` object cannot be approved through the panel yet.

## 10. Appendix: one compiled ACL, end to end

Policy (v2, outbound also default-block so the reply rules are visible):

```jsonc
{
  "version": 2,
  "mode": "rules",
  "chains": {
    "inbound":  { "default": "block", "enabled": true },
    "outbound": { "default": "block", "enabled": true },
    "forward":  { "default": "block", "enabled": true }
  },
  "rules": [
    { "name": "web-db", "action": "allow", "from": ["tag:web"],
      "to": ["tag:db"], "protocol": "tcp", "ports": ["5432"],
      "rateLimit": 200, "burst": 100 }
  ]
}
```

Devices: `web` = 10.14.0.2 (`tag:web`), `db` = 10.14.0.3 (`tag:db`).

`db`'s compiled `NetworkConfig.acl` (`acl.Protocol` 1 = TCP, `Action` 1 =
Allow/2 = Drop, `ChainType` 1/2/3 = Inbound/Outbound/Forward). Secret values
are derived and shown as placeholders:

```json
{
  "aclV1": {
    "chains": [
      {
        "name": "easyplane-inbound",
        "chainType": 1,
        "enabled": true,
        "rules": [
          {
            "name": "web-db-in",
            "priority": 65535,
            "protocol": 1,
            "ports": ["5432"],
            "sourceIps": ["10.14.0.2/32"],
            "destinationIps": [],
            "sourcePorts": [],
            "action": 1,
            "rateLimit": 200,
            "burstLimit": 100,
            "stateful": true,
            "sourceGroups": [],
            "destinationGroups": []
          }
        ],
        "defaultAction": 2
      },
      {
        "name": "easyplane-outbound",
        "chainType": 2,
        "enabled": true,
        "rules": [
          {
            "name": "web-db-reply-out",
            "description": "replies for web-db (egress)",
            "priority": 1000,
            "protocol": 1,
            "ports": [],
            "sourceIps": [],
            "destinationIps": ["10.14.0.2/32"],
            "sourcePorts": ["5432"],
            "action": 1,
            "rateLimit": 0,
            "burstLimit": 0,
            "stateful": true
          }
        ],
        "defaultAction": 2
      }
    ],
    "group": {
      "declares": [{ "groupName": "tag:db", "groupSecret": "<derived>" }],
      "members": ["tag:db"]
    }
  }
}
```

`web`'s ACL carries `web-db-out` (destination 10.14.0.3/32, ports 5432) in its
Outbound chain because that chain is default-block. With `options.strictTags`
the inbound rule also gets `"sourceGroups": ["tag:web"]` and `db` declares
`tag:web` too, so it can verify the proof. The reverse rule's low priority
(1000) is what lets an explicit deny anywhere in the document outrank it.

Golden tests for these shapes live in
`apps/server/test/unit/policy-compiler.test.ts`; the real-client evidence is in
`test/conformance/policy-spike.test.ts` and `test/conformance/m2.test.ts`.
