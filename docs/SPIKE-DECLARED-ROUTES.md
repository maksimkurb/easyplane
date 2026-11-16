# Spike: device-declared routes on ONE managed instance

Status: **implemented.** This page records what a real, unmodified
`easytier-core 2.6.4-81487c36` does when the *managed* instance is also the place
where routes are declared. The measurements below are the evidence base for the
implementation; the resulting semantics are in [POLICY.md §7.1](POLICY.md).

The upstream sources are read from a scratch checkout pinned to
`81487c363a…`. A newer checkout in `/home/maksimkurb/Dev/EasyTier` differs in at
least one relevant place: after the pin, `network_config_from_toml` stopped
requiring a non-empty route list before reporting `enable_manual_routes`. The
pinned client uses the older rule, and the panel's drift comparison accounts for
it (see §5).

Ref: `81487c363a56779e745eae927e130a813535c71e` (pinned conformance build).
Harness: `test/conformance/declared-routes.test.ts` +
`docker-compose.test.yml` services `core-dr-{a,b,c}`.

Every claim is labelled **[verified by running]** (real containers, real
sockets, `test/conformance/device-routes-spike.test.ts`, 7/7 green) or
**[source]** (read from the pinned upstream checkout at
`/home/maksimkurb/Dev/EasyTier`).

## 0. The workflow that was tested

```
device                                   panel
------                                   -----
easytier-core --config-server ws://panel/<token>
              --config-dir /cfg
        |  pushes NetworkConfig
        +-------------------------------->  RunNetworkInstance
        |  client writes /cfg/<instance-id>.toml (0600)
        v
   operator: stop easytier-core
   operator: edit /cfg/<instance-id>.toml
             [[proxy_network]] cidr = "10.99.1.0/24"
             [flags] enable_exit_node = true
   operator: start easytier-core
        |
        +-- startup: load every *.toml in /cfg ----> instance runs from the file
        +-- GetNetworkInstanceConfig -------------> panel sees the declaration
        +-- heartbeat ----------------------------> panel decides: push or not
```

One process, one instance, one file. There is no second instance and no second
process anywhere in this spike.

## 1. Answers

| # | question | answer | evidence |
| --- | --- | --- | --- |
| 1 | Is a config-server-managed instance persisted to `--config-dir`? | **Yes.** The client writes `<instance-id>.toml`, mode `0600`, before replacing the running instance. | [verified by running] + [source] |
| 2 | Is the edited file reloaded on restart, before/without a panel push? | **Yes.** The instance starts from the file with the edited `proxy_network` and `enable_exit_node`; the panel is not involved in loading it. | [verified by running] |
| 3 | Does a later `RunNetworkInstance` refuse or overwrite the edit? | **Overwrites**, because the managed file is `EDITABLE|DELETABLE`. An external *read-only* file is refused, but then the panel also cannot read the config. | [verified by running] + [source] |
| 4 | Does `GetNetworkInstanceConfig`/`ListNetworkInstance` report the edit? | **Yes** for the config-dir case (proxy CIDR, exit-node flag, source, permission). **No** for a read-only instance: the RPC itself is refused. | [verified by running] + [source] |
| 5 | Do peers see the edit in `CollectNetworkInfo`? | **Yes**, as `routes[].proxy_cidrs` on the device's *own* overlay IP, so it is attributable to the device, not an unknown peer. The exit-node flag is **not** visible to peers. | [verified by running] |
| 6 | Does `enable_manual_routes` + `routes` on a receiver stop an unapproved CIDR from being installed? | **Yes.** Empty list = no route installed, unreachable; the approved list = installed, reachable. | [verified by running] |
| 7 | Does a receiver use an exit node without `exit_nodes`? | **No.** And even *with* `exit_nodes`, it does not route internet traffic through the exit node unless the OS route sends it into the TUN. | [verified by running] + [source] |

## 2. Persistence: what exactly is written

`ProcessManagement::run_network_instance`
(`easytier-core/src/management/full/process_rpc.rs` ~L205–300) picks the file
path from the instance manager's config dir:

```rust
} else if let Some(config_dir) = self.instances.config_dir() {
    config.set_network_config_source(requested_source);
    ConfigFileControl::new(
        Some(config_dir.join(format!("{instance_id}.toml"))),
        ConfigFilePermission::default(),
    )
}
```

and, for a writable control, writes the dump **before** deleting/replacing the
running instance, keeping the previous bytes for rollback. The writer is
`NativeConfigFileStorage::write` (`easytier/src/instance/config_storage.rs`):
atomic replace, mode `0600`.

The file produced by a panel push (real dump, [verified by running]):

```toml
hostname = "core-dr-a"
instance_name = "declared-routes-spike-b2e768"
instance_id = "3e041dd0-1887-5c8c-81c9-baf91c5d1bbc"
ipv4 = "10.88.0.2/24"
dhcp = false
listeners = ["tcp://0.0.0.0:11021"]

[network_identity]
network_name = "declared-routes-spike-b2e768"
network_secret = "<redacted>"

[flags]

[source]
source = "web"
```

Note `[source] source = "web"`: the panel's source is written into the file and
survives an operator edit. It is what `GetNetworkInstanceConfig.source` and
`ListNetworkInstanceMeta.source` report back (`2` = `ConfigSourceWeb`).

`ListNetworkInstanceMeta` for this instance reports `configPermission = 0`
(`EDITABLE|DELETABLE`) — see §4 for the read-only variant.

## 3. Restart with the edit: before/after

Operator edit applied on the stopped device (the whole `[flags]` table and a new
`[[proxy_network]]` block):

```toml
[flags]
enable_exit_node = true

[source]
source = "web"

[[proxy_network]]
cidr = "10.99.1.0/24"
```

`GetNetworkInstanceConfig` after restart [verified by running]:

| field | before | after |
| --- | --- | --- |
| `proxyCidrs` | `[]` | `["10.99.1.0/24"]` |
| `enableExitNode` | `false` | `true` |
| `source` | `2` (web) | `2` (web) |
| meta `configPermission` | `0` | `0` |

The peer view [verified by running] — `core-dr-b`'s `CollectNetworkInfo([])`:

```json
{ "ipv4": 173539330, "hostname": "core-dr-a", "proxyCidrs": ["10.99.1.0/24"] }
```

`173539330 == 10.88.0.2`, i.e. the device's **own managed instance** overlay
address. The advertisement is therefore attributed to the device by virtual IP;
there is no second instance and no `unknownPeer`. Peers only see CIDRs; the
exit-node flag is instance-local and never crosses `CollectNetworkInfo`
(`RoutePeerInfo` has no such field) — [source].

## 4. What a panel push does to the edit

### 4.1 File inside `--config-dir` (the intended setup): **it overwrites it**

`load_config_from_file` (`easytier/src/common/config.rs` ~L91–140) marks a file
managed when it is `<config_dir>/<instance-id>.toml`: the file stays editable
and deletable. `RunNetworkInstance` with `overwrite = true` then:

1. `ensure_overwritable` passes (control is not read-only, and the core binary's
   `manages_remote_config_instances()` is `false`, so `NO_DELETE` alone never
   blocks anything — [source]);
2. backs up the current file bytes;
3. writes the panel dump (atomic, `0600`);
4. deletes and re-creates the instance (a short overlay interruption);
5. restores the backup only if step 4 fails.

Measured [verified by running], directly after `pushNow` with the panel's
desired state (no approved routes):

```
pushResult = { "status": "pushed", "revision": 2 }
own config  = { proxyCidrs: [], enableExitNode: false }
file        = no [[proxy_network]], [flags] empty
```

So the answer to "does the panel push refuse, ignore, or overwrite" is
**overwrite**, and a push with an **empty `proxy_cidrs`/exit flag removes the
declaration**. There is no error, no warning and no drift signal left.

This is why the implementation must stop the 15 s reconciler from pushing while
a declaration is pending (see §8). Otherwise the operator's edit survives at
most one reconcile interval after the client reconnects.

### 4.2 External `-c` file, `chmod 0444`: **refused — and unreadable**

Same instance, run from `/etc/easytier/device.toml` (outside the config dir,
mode `0444`, bind-mounted `:ro`). [verified by running]

| fact | value |
| --- | --- |
| `ListNetworkInstanceMeta` | `configPermission = 3` (`READ_ONLY|NO_DELETE`) |
| `GetNetworkInstanceConfig` | **RPC error**: `configuration for instance <id> is read-only` |
| `RunNetworkInstance` | **RPC error**: `instance <id> is read-only, cannot be overwritten` |
| panel result | `{ status: "error", reason: "instance <id> is read-only, cannot be overwritten" }`, `lastPushError` set |
| own-config report | empty (the panel's collector swallows the read error and defaults to `[]`/`false`) |
| peer view | still `10.88.0.2 → 10.99.1.0/24` |
| audit rows `device.config.push_failed` in ~5 s | **6** (heartbeat reschedules while `lastPushError` is set) |

Two consequences:

- A read-only file is the *honest* "panel cannot manage this" mode: the panel
  cannot revert the edit, but it also cannot read it. Only peer observations
  (CIDR, no exit flag) remain.
- The failure path is a **retry loop**: `handleHeartbeat` schedules a push when
  `lastPushError !== ""`, so every heartbeat retries a push that can never
  succeed. Any implementation must classify "read-only config" as a state, not
  an error, and back off.

`get_network_instance_config` refusing read-only instances is upstream code
(`process_rpc.rs` ~L700–726):

```rust
if control.is_read_only() {
    return Err(anyhow::anyhow!("configuration for instance {instance_id} is read-only").into());
}
```

## 5. Receiver enforcement (the important part)

Three real clients on one bridge, A advertising `10.99.1.0/24` from its edited
managed instance. B is `acceptRoutes = true`, C is `acceptRoutes = false`.
[verified by running]

| receiver config | `ip route` | `curl http://10.99.1.10:8080` |
| --- | --- | --- |
| B as pushed by the panel today: `routes: []`, `enableManualRoutes` unset | `10.99.1.0/24 dev tun0 proto static metric 65535` | **200** |
| B manually pushed with `enableManualRoutes: true`, `routes: []` | route **absent** | **000** (timeout) |
| B with `enableManualRoutes: true`, `routes: ["10.99.1.0/24"]` | route present | **200** |
| C as pushed today: `acceptRoutes = false`, `routes: []` | route **present** | (not probed) |

Source backing (`easytier-core/src/gateway/proxy/cidr_monitor.rs`):

```rust
fn resolve_proxy_cidrs(peer_routes, config) -> BTreeSet<Ipv4Cidr> {
    if let Some(manual_routes) = config.manual_routes { return manual_routes; }
    peer_routes
}
```

`gen_config` sets `manual_routes = Some(settings.routes)` whenever
`enable_manual_routes` is true, **including the empty list**
(`easytier-core/src/config/api_input.rs` ~L423). So:

- **without** `enable_manual_routes`, every advertised proxy CIDR is installed
  into the receiver's route table automatically;
- **with** it, the receiver installs exactly the given list, and an empty list
  installs nothing.

The second half is not observable through `GetNetworkInstanceConfig` on the
pinned client: its `network_config_from_toml`
(`easytier-core/src/config/api.rs`, ~L616) only sets
`enable_manual_routes = Some(true)` when `routes` is **non-empty**. An empty
manual list therefore reads back as "flag absent, `routes: []`". `gen_config`
still applies it (`api_input.rs` ~L285), so enforcement works; the panel only
compares the flag when its own list is non-empty (and the conformance test
asserts the route table, not the flag).

At spike time the panel emitted `enableManualRoutes` only when the route list
was non-empty (`buildMinimalNetworkConfig`), so no receiver was constrained,
including devices that never opted into `acceptRoutes`. The implementation now
always emits it with an explicit list (empty for devices without approved
routes); see POLICY.md §7/§7.1 and DEPLOY.md §4b for the behaviour change.

## 6. Exit node

[verified by running] with A as an exit node (`enableExitNode = true`, edited
file) and a target `203.0.113.7:8081` reachable only on A's loopback:

| receiver state | result |
| --- | --- |
| C, `exitNodes: []` | `000` |
| C, `exitNodes: ["10.88.0.2"]` | `000` |
| C, same + `ip route replace 203.0.113.7 dev tun0` | **`200`** |
| C, `exitNodes: [...]`, `routes: ["0.0.0.0/0"]`, `enableManualRoutes: true` | `000`; route table has `default dev tun0 proto static metric 65535` next to `default via 172.28.0.1 dev eth0` (metric 0 wins) |

Source: `get_msg_dst_peer_ipv4` only consults `self.exit_nodes` for a packet
whose destination is outside the overlay and which reached the peer manager
(`easytier-core/src/peers/peer_manager.rs` ~L2730). Nothing in
`NetworkConfig` installs an OS default route into the TUN. The exit-node flag is
advertised nowhere; a client learns about an exit node purely from its own
`exit_nodes` list.

Consequences for the feature:

- An *unapproved* exit node is unusable by any managed receiver: the panel
  currently always pushes `exitNodes: []` (hard-coded in `buildNetworkConfig`),
  and even if it didn't, the traffic would still leave via the physical default
  route. Enforcement is structural, but so is "approval has no effect".
- Approval of an exit node can only be a **recorded consent/badge**. Making it
  actually usable needs (a) `exitNodes` on the clients, (b) an OS-level route
  into the TUN (or policy routing), neither of which is in `NetworkConfig`.
  That is a separate feature and must not be promised by this one.

## 7. What the panel can and cannot learn

| signal | config-dir instance | read-only external `-c` instance |
| --- | --- | --- |
| `ListNetworkInstance` / `Meta` | yes (`source=web`, permission 0) | yes (`permission=3`) |
| `GetNetworkInstanceConfig` (CIDRs + exit flag) | **yes** | **no (RPC refused)** |
| peers' `CollectNetworkInfo` (CIDRs only) | yes, on the device's own overlay IP | yes, same |
| peers see the exit-node flag | never | never |
| panel can push/revert | yes (overwrites the file) | no (refused) |

Therefore the primary detection signal is the device's **own config**
(`GetNetworkInstanceConfig`), exactly as the requirement states; peers are the
fallback and cannot detect exit-node declarations.

One more detail for the collector: the panel's `collectReport` already calls
`GetNetworkInstanceConfig(managedId)` and reads `proxyCidrs` /
`enableExitNode`, but on error it silently stores `[]`/`false`. In the
read-only case the report says "no routes" while the peers still see the
advertisement. Any implementation should surface the read failure and use the
peer observation for the CIDR instead of pretending there is none.

## 8. Implementation (what was built)

The plan below was implemented with one deliberate change: instead of freezing
the push loop while a declaration is pending (which would delay policy, peer and
credential changes), the panel **adopts** pending declarations into the device's
own pushed config. Receivers still only get approved routes.

1. **Workflow.** One client,
   `--config-server ws://…/<token> --config-dir /var/lib/easytier-client`, no
   second instance. Docs: "stop the client, edit
   `/var/lib/easytier-client/<instance-id>.toml`, start the client". The file
   contains the network secret and is `0600`. A read-only external `-c` file is
   not supported for declarations (the panel can neither read nor revert it).
2. **Detect the declaration from the device's own config.** In
   `PushService.collectReport`, keep the own-config read for the managed
   instance (it is the same instance now), and compare `proxyCidrs` /
   `enableExitNode` with the approved routes. Unapproved values become
   `device_routes` rows with `source = 'device_declared'`, `state = 'pending'`,
   created idempotently (the existing unique index
   `(device_id, kind, cidr)` gives this for free; an existing rejected row must
   not be resurrected). Audit `route.declared` once per row, never per poll.
   Fallback: peer-observed CIDRs on the device's own overlay IP, when the own
   config is unreadable.
3. **Never erase the edit.** Detection runs *before* the drift comparison
   (`declareRoutes` in `ensureInner`), and every push includes the device's
   pending and approved declared routes in its own `proxy_cidrs` /
   `enable_exit_node`. The 15 s reconciler therefore finds no drift and the
   edit survives; receivers still get only approved routes. Trade-off: the
   panel re-asserts a pending declaration, so an online pushed device keeps
   advertising it until the admin decides. The `advertised` flag covers the
   cases where it can disappear (offline, read-only file, foreign id).
4. **On approval, the route becomes network state.** `approvedSubnetCidrs` /
   `approvedExitNode` include approved `device_declared` rows, so the push
   writes `[[proxy_network]]` / `enable_exit_node = true` into the *same*
   instance's file (verified: the same instance keeps serving and B still
   reaches the subnet). No duplicate advertisement, no second instance.
   Decisions push every approved device, because the receivers' manual-route
   list changes too.
5. **Constrain every receiver.** Always push `enable_manual_routes = true` with
   `routes = acceptRoutes ? approved subnet routes of others : []`. This is a
   behaviour change: devices that did not accept routes currently install every
   advertised CIDR; after the change they install none. Call it out in the
   release notes. (`acceptRoutes` remains the per-device consent bit.)
6. **On rejection, be explicit.** The route is not distributed; one push
   restores the advertiser's desired state (the config-dir file loses the
   entry). A read-only file cannot be reverted; the panel shows that state and
   does not retry. A rejected row is never re-proposed by a later report.
7. **Classify "read-only config" as a state, not an error.** If
   `ListNetworkInstanceMeta.configPermission` has `READ_ONLY` (bit 1), the
   device reports `configManagedLocally`, pushes are skipped, `lastPushError` is
   cleared and no `device.config.push_failed` audit is written. The permission
   is refreshed on the next reconcile, so replacing the file with a writable
   one recovers. This also fixes the retry loop in §4.2.
8. **Exit nodes stay consent-only.** Show approved/proposed badges, never
   `exitNodes` on clients, never `enable_exit_node` on the managed instance for
   a declared exit node (it is already local). Document that actual exit-node
   egress needs an OS route into the tunnel and is out of scope.
9. **Disappearance.** `device_routes.last_declared_at` is refreshed by every
   report that shows the declaration; older than five minutes sets
   `advertised: false` and the UI says "no longer advertised". Rows are never
   auto-withdrawn or deleted, and approvals are not reverted.

## 9. Risks

- **Push gating is the load-bearing part.** Any code path that pushes without
  checking the pending declaration (retry button, policy save, credential
  rotation, rollback) wipes the operator's edit. Each path must go through the
  same gate.
- **The file is the panel's desired state, not a user file.** Every push rewrites
  it; edits outside the modelled fields (listeners, MTU, flags) are lost. Say so
  in the how-to.
- **Secrets.** The file has `0600` and contains the network secret; backups,
  docs and support bundles must not paste it.
- **Instance identity.** The file name and `instance_id` must stay the
  deterministic one. A renamed file or changed `instance_id` makes the panel
  push a *second* instance (same process) and the declaration disappears from
  the managed view.
- **`[source] source = "web"`** survives edits; a UI that keys "managed by
  panel" off the source must use `configPermission`/the push gate instead.
- **Exit node expectations.** "Approved" must not be presented as "clients now
  use it". They don't, and cannot without OS routing.
- **Peer-only fallback is lossy.** It sees CIDRs, never the exit flag, and only
  while another member is online; it must be labelled as a fallback.
- **Tests.** The conformance topology needs `--config-dir`, a bind mount and a
  real stop/edit/start cycle; it is slower than the existing M2 route test but
  is the only honest proof of this workflow.

## 10. How to reproduce

```bash
# real pinned client + Docker
scripts/build-test-client.sh                 # once, if docker/easytier-core is missing
bunx vitest run --project conformance \
  test/conformance/declared-routes.test.ts
```

The test starts the three `core-dr-a/b/c` compose services and the M2 relay,
then exercises the stop/edit/start cycle, proposals, approval/rejection,
read-only mode and the foreign-id case. The relay now uses a LIFO host pool so a
restarted client pairs with a fresh socket.

## 11. Remaining limits

- Per-client `exit_nodes` is not managed; approval is consent only.
- A read-only file's declaration is not readable by the panel (upstream refuses
  even `GetNetworkInstanceConfig`), so only peer-observed CIDRs are visible.
- A foreign `instance_id` is not attributed; the extra instance shows up as an
  `unknownPeer` and receivers do not install its routes.
- Pending declarations are re-asserted by the panel, so the "no longer
  advertised" state mainly covers offline/read-only/foreign-id cases.
