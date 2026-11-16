# EasyTier config-server wire protocol (as implemented by EasyPlane)

This document describes only what the control plane needs in order to be
wire-compatible with **unmodified** `easytier-core` clients that use
`--config-server`. Everything here was derived from the pinned upstream commit

```
81487c363a56779e745eae927e130a813535c71e   (2026-08-24, "fix(web): fence routes to the current session")
```

which is newer than the official `v2.6.4` tag (`8428a89d`, 2026-05-12), even
though `Cargo.toml` still says `2.6.4`.

Every claim below is labelled:

- **[verified]** — exercised against a real `easytier-core` 2.6.4-81487c36 in
  `test/conformance/*` (docker containers, real sockets).
- **[source]** — read from the pinned sources; not directly exercised in M0.

## 1. Protobuf definitions

Only the upstream `.proto` files are imported: `proto/easytier/*.proto` is a
verbatim copy of `easytier-proto/proto/*.proto` at the pinned commit
(`proto/easytier/UPSTREAM_REF` records the commit). TypeScript bindings in
`packages/proto/src/generated` are produced by `ts-proto` with
`forceLong=bigint` (64-bit RPC transaction ids must not lose precision) and
`importSuffix=.js` (NodeNext ESM).

- `scripts/sync-protos.sh <tag|commit>` re-copies and regenerates.
- `scripts/check-protos.sh` fails when the copy or the generated code drifts;
  it is wired into CI.

## 2. Connection / endpoint handling

Client side: `easytier-core/src/management/full/web_client.rs`
(`ConfigServerEndpoint::parse`, `web_client_routine`).

- Supported schemes come from `TunnelScheme`: `tcp`, `udp`, `ws`, `wss`,
  `ring`, `quic`, `wg` … The control plane implements `tcp`, `ws`/`wss` and,
  since M4, `udp` (§13.1).
- The **token is the last URL path segment**, percent-decoded. An empty token
  is rejected by the client before dialling.
- For non-websocket schemes the client **clears the URL path** before
  dialling, so for `tcp://host:port/<token>` and `udp://host:port/<token>` the
  token never appears on the wire; it is only carried in
  `HeartbeatRequest.user_token`. [verified]
- For `ws`/`wss` the full URL (including the token path) is used for the
  WebSocket handshake. [verified]
- The client retries every **1 s** on any connection failure
  (`RETRY_INTERVAL`), with a 20 s connect timeout. [verified — reconnect test]
- Heartbeats are sent every **1 s** (`time::interval(1s)`), the first one
  immediately after the tunnel is established. [verified]

## 3. Tunnel framing

The control channel is a `ZCPacket` stream (`easytier-core/src/packet/mod.rs`,
`easytier-core/src/tunnel/framed.rs`, `easytier/src/tunnel/websocket.rs`).

### 3.1 TCP

```
+----------------+------------------------------------------+
| u32 LE  length | tunnel payload (length bytes)             |
+----------------+------------------------------------------+
```

`length = 16 (peer-manager header) + payload length`, minimum 16. A frame is
rejected when `length < 16` or `length > max_packet_size`; the Rust reader uses
`TCP_MTU_BYTES = 2000`, so **packets we send over TCP must stay below ~2 kB**
(this is why the control plane keeps requests small and relies on multi-piece
reassembly for responses). [source for the 2000-byte limit; verified in that
all TCP RPCs in the conformance suite stay below it]

### 3.2 WebSocket

Each binary WebSocket message **is** one tunnel payload — there is no extra
length prefix. Text frames are a protocol error, close frames end the stream.
[verified]

### 3.3 Peer-manager header (16 bytes, little-endian, packed)

| offset | size | field |
| --- | --- | --- |
| 0 | 4 | `from_peer_id: u32` |
| 4 | 4 | `to_peer_id: u32` |
| 8 | 1 | `packet_type: u8` |
| 9 | 1 | `flags: u8` |
| 10 | 1 | `forward_counter: u8` |
| 11 | 1 | reserved |
| 12 | 4 | `len: u32` (payload length, header excluded) |

Packet types used here: `RpcReq = 8`, `RpcResp = 9`. Flags used here:
`ENCRYPTED = 0x01`. `forward_counter` is `1` in packets built by EasyTier.

[verified]

## 4. Web-secure mode (Noise + AES-GCM)

Sources: `easytier-core/src/tunnel/web_security.rs`,
`easytier-core/src/tunnel/secure_datagram.rs`,
`easytier-core/src/tunnel/encrypt/aes_gcm.rs` (+ `ring.rs` for the golden
vector).

### 4.1 Negotiation

1. The client connects plainly and calls `GetFeature` (method 2).
2. The server answers `GetFeatureResponse{support_encryption}`.
   EasyTier answers `web_secure_tunnel_supported()`, which is true whenever an
   AEAD backend is compiled in (the default build enables `ring-crypto` through
   the `wireguard` feature). EasyPlane answers `true` by default.
3. If the client supports encryption and the server advertised it, the client
   **drops the connection, reconnects, and starts the Noise handshake
   immediately** (`upgrade_client_tunnel`). [verified]
4. If the server answers `false` and the client was started with
   `--secure-mode` (or `ET_SECURE_MODE=true`), the client refuses to use the
   tunnel and retries every second. [source]

The server side waits up to 3 s for the first tunnel payload; if it does not
start with the Noise magic the connection stays plain and the first packet is
replayed to the RPC layer (`accept_or_upgrade_server_tunnel`). [verified]

### 4.2 Handshake

- Pattern: `Noise_NN_25519_ChaChaPoly_SHA256`
- Prologue: `easytier-webclient-noise-v1`
- Magic prefix on every handshake *payload*: `ET_WEB_NOISE_V1:`
  (`b"ET_WEB_NOISE_V1:"`, 16 bytes)

Messages (each wrapped in a normal tunnel payload with a 16-byte
peer-manager header, `packet_type = Data`):

| message | bytes | content |
| --- | --- | --- |
| msg1 (initiator) | 32 | `e` only. Because no key exists yet, snow writes the empty payload verbatim (0 bytes). |
| msg2 (responder) | 80 | `e` (32) + ChaChaPoly-encrypted payload (48 = 32-byte root key + 16-byte tag). |

After `e`, `ee` is mixed (HKDF over the X25519 secret), then the responder
encrypts a **fresh random 32-byte root key** as the msg2 payload. EasyTier
never sends msg3 and never uses the Noise cipher states for data; the root key
is all that matters. [verified — the real client accepts this exact handshake]

Implementation detail that matters: the protocol name is exactly 32 bytes, so
`h` starts as the name itself (no hash), then `h = SHA256(h || prologue)`.

### 4.3 Traffic keys

For each `(epoch, direction)`:

```
PRK      = HMAC-SHA256(key = 0x00 * 32, msg = root_key)          # HKDF extract
info     = "et-traffic" || epoch_be32 || dir_u8                   # 15 bytes
traffic  = HMAC-SHA256(key = PRK, msg = info || 0x01)             # HKDF expand, 1 block
AES key  = traffic[0..16]                                         # aes-gcm => AES-128-GCM
```

`dir_u8` is `0` for initiator→responder (`AToB`) and `1` for B→A. The server is
the responder, so it **sends with dir 1 and receives with dir 0**.

### 4.4 Encrypted packet layout

```
outer tunnel payload = [16-byte header, flags |= 0x01]
                     + AES-128-GCM(ciphertext)
                     + tag (16)
                     + nonce (12)
```

- Plaintext = the *inner* tunnel payload (inner header + RPC bytes).
- No associated data.
- Nonce = `epoch_be32 || seq_be64`; the nonce is also appended in the clear so
  the receiver can derive the key (the same field ordering as
  `StandardAeadTail { tag, nonce }`).
- `seq` starts at 0 for each epoch; the sender rotates the epoch after
  1,000,000 packets or 10 minutes.
- The receiver keeps a 256-packet replay window per direction and rejects
  epochs more than 3 ahead of the current one.

Golden vector for the traffic key (also asserted in
`apps/server/test/unit/secure-datagram.test.ts`):

```
root = 000102...1f, epoch 0, dir 0
  => 5f6aeafd4b1a023ef03ae837e7138631a416a1629d0cd3a97ec039d39c04add7
root = 000102...1f, epoch 5, dir 1
  => b81cacbf4b060e4b0bd43aaac530f80564f9737c328b4b857dd21583d37f025b
```

[verified end-to-end: heartbeats and RPCs flow over this encryption]

## 5. RPC layer

Sources: `easytier-core/src/rpc/{packet,client,server,bidirect}.rs`,
`easytier-proto/proto/common.proto`, `easytier-proto/build/rpc.rs`.

Every tunnel payload with `packet_type` `RpcReq`/`RpcResp` carries a protobuf
`common.RpcPacket`:

```proto
message RpcPacket {
  uint32 from_peer = 1;
  uint32 to_peer = 2;
  int64 transaction_id = 3;
  RpcDescriptor descriptor = 4;
  bytes body = 5;            // RpcRequest or RpcResponse, possibly compressed
  bool is_request = 6;
  uint32 total_pieces = 7;
  uint32 piece_idx = 8;
  int32 trace_id = 9;
  RpcCompressionInfo compression_info = 10;
}
message RpcRequest  { RpcDescriptor descriptor = 1 [deprecated]; bytes request = 2; int32 timeout_ms = 3; }
message RpcResponse { bytes response = 1; error.Error error = 2; uint64 runtime_us = 3; }
```

- **Descriptor**: `{domain_name, proto_name, service_name, method_index}`.
  The config-server channel uses an empty domain and identical `proto_name` /
  `service_name` (e.g. both `WebServerService`).
- **Method indexes are 1-based** (`build/rpc.rs` does `Method::new((i + 1) as u8, …)`).
  This is the easiest detail to get wrong.
- **Peer ids**: `easytier-web` calls `scoped_client::<F>(1, 1, "")`, i.e.
  `from_peer = to_peer = 1` in both directions; the responder swaps them.
  [verified]
- **Transaction ids**: `int64`, seeded from a random value and incremented; the
  responder echoes the id. We decode them as `bigint`. [verified]
- **Request timeout**: the client's `BaseController::default()` uses 5000 ms;
  we send `timeout_ms = 5000` so the remote dispatch is bounded. [source]
- **Pieces**: responses larger than the UDP budget (~1248 encoded bytes,
  `RPC_PACKET_UDP_PAYLOAD_BUDGET = 1300`) are split into `total_pieces` pieces
  with `piece_idx`, even over TCP/WebSocket. A receiver must reassemble by
  `(is_request, from_peer, transaction_id)`. `CollectNetworkInfo` on a running
  instance exercises this. [verified]
- **Compression**: `compression_info.accepted_algo` advertises zstd support.
  EasyTier compresses a body only when the compressed form is smaller.
  EasyPlane leaves `compression_info` unset in its requests, which makes the
  client return **uncompressed** responses (its `compress_packet(None)` path).
  Inbound client requests do carry `compression_info` (observed `algo = None`
  with bodies of 3–188 bytes; no zstd body was ever observed because
  heartbeat-sized payloads do not shrink), but any inbound zstd body is still
  decoded, via `zlib.zstdDecompressSync` when available or the pure-JS
  `fzstd` fallback, so Node 22+ works too. [verified for the None path; source
  for the zstd path, with a frame-format unit test]

## 6. Services on the control channel

### 6.1 `WebServerService` (server side, implemented here)

`easytier-proto/proto/web.proto`, registered by `easytier-web` at domain `""`.

| index | method | request | response |
| --- | --- | --- | --- |
| 1 | `Heartbeat` | `HeartbeatRequest` | `HeartbeatResponse{}` |
| 2 | `GetFeature` | `GetFeatureRequest{}` | `GetFeatureResponse{support_encryption}` |

`HeartbeatRequest` fields used in M0:

| field | meaning |
| --- | --- |
| `machine_id` (`common.UUID`) | stable UUID of the host (four big-endian-free `u32` parts; the wire order follows the UUID text order) |
| `inst_id` | session UUID, regenerated per connection |
| `user_token` | the token from the config-server URL (authoritative for auth over tcp) |
| `easytier_version` | e.g. `2.6.4-81487c36` |
| `report_time` | RFC3339 local time from the client |
| `hostname` | `--hostname` or the machine hostname |
| `running_network_instances` | instance UUIDs the client currently runs |
| `device_os` | `{os_type, version, distribution}` |
| `support_config_source` | whether the client understands `ConfigSource` (true on 2.6.4) |

Erroring a heartbeat (any RPC-level error) makes the client log the failure,
tear down the session, and retry in 1 s. EasyPlane uses this for unknown
tokens. [verified]

### 6.2 `WebClientService` (client side, called by the server)

`easytier-proto/proto/api_manage.proto`, service registered by the client in
its own `BidirectRpcManager` whenever a tunnel is up.

| index | method | M0 |
| --- | --- | --- |
| 1 | `ValidateConfig` | used, returns TOML |
| 2 | `RunNetworkInstance` | used |
| 3 | `RetainNetworkInstance` | implemented, not required by M0 |
| 4 | `CollectNetworkInfo` | used |
| 5 | `ListNetworkInstance` | used |
| 6 | `DeleteNetworkInstance` | used by M1 block/delete (§10.2) |
| 7 | `GetNetworkInstanceConfig` | used |
| 8 | `ListNetworkInstanceMeta` | used |

`RunNetworkInstanceRequest{inst_id, config, overwrite, source}`; `source` is
`ConfigSourceWeb = 2` for configs pushed by a control plane, and
`GetNetworkInstanceConfig` reports that source back. [verified]

## 7. Pushed NetworkConfig (M0 subset)

`easytier-core/src/config/api_input.rs` (`NetworkConfigExt::gen_config`) is the
only consumer; repeated fields are mandatory in the generated type but empty
lists are fine.

Minimal working config pushed by the conformance suite:

```ts
{
  instanceId: "<uuid>",
  hostname: "conformance-node",
  networkName: "easyplane-conformance",
  networkSecret: "conformance-secret",
  networkingMethod: Standalone /* 2 */,
  dhcp: false,
  virtualIpv4: "10.144.144.1",
  networkLength: 24,
  peerUrls: [], listenerUrls: [], proxyCidrs: [], routes: [],
  exitNodes: [], mappedListeners: [], portForwards: [],
  managedCredentials: [], peers: [], relayNetworkWhitelist: [],
}
```

Observed behaviour with the real client:

- `ValidateConfig` returns the TOML that `gen_config` produced. [verified]
- `RunNetworkInstance` returns the instance UUID; the instance starts and
  `CollectNetworkInfo` reports `running = true`, the virtual IPv4, hostname,
  version, peer id, listeners (`ring://<instance-id>`), events, and an empty
  peer list for a standalone network. [verified]
- `GetNetworkInstanceConfig` round-trips the config and reports
  `source = ConfigSourceWeb`; note that upstream **normalises** some fields
  (`networkingMethod` came back as `Manual`, `bindDevice`/`multiThread` pick up
  build defaults). Do not assume a byte-for-byte echo. [verified]
- With `no_tun = true` the instance still runs and reports
  `dev_name = ""`; with TUN available a `tun0`-style device carrying the
  virtual IP is created. [verified in a container with `/dev/net/tun`]
- `ListNetworkInstance` / `ListNetworkInstanceMeta` list the instance; the meta
  carries `networkName`, `instanceName`, `configPermission`, `source`. [verified]

## 8. Not implemented (and why)

- **Noise msg3 and Noise transport keys.** EasyTier never uses them; the root
  key from msg2 is the whole contract.
- **Peer-to-peer data plane / instance RPC portal.** EasyPlane only speaks the
  config-server control channel; it never joins the overlay as a peer.
- **Web-secure key rotation on the client side** is handled (we accept up to 3
  epochs ahead and keep a 256-packet replay window); we do not implement the
  `sync_root_key` rekey message because EasyTier's web client never sends one.
- **`RetainNetworkInstance` reconciliation loop.** The method is implemented and
  callable, but M1 converges devices with `RunNetworkInstance` + verification
  instead (see §10.4) rather than deleting whatever the server does not list.
  `RetainNetworkInstance` remains available for a future "adopt and prune" mode.
- **Importing a credential-mode config** (`secure_mode.local_private_key` or
  `credential_file` with no `network_secret`). EasyPlane *runs* credential
  networks (§15) but refuses to adopt such a config as a network: the private
  key is a device identity, not a network. The error points at the supported
  flow (create the network, add the device as a member).
- **zstd compression of our own RPC bodies.** We always send uncompressed and
  ask the client not to compress responses. Inbound zstd is supported when the
  Node runtime provides `zlib.zstdDecompressSync`.

## 9. How M0 was verified

`test/conformance/*.test.ts` starts the TypeScript control plane on the host
and real `easytier-core` containers from `docker-compose.test.yml`
(`network_mode: host`, `/dev/net/tun`, `CAP_NET_ADMIN`), then asserts:

| test | proves |
| --- | --- |
| `ws.test.ts` | ws accept, Noise upgrade, GetFeature, Heartbeat pacing, ValidateConfig, RunNetworkInstance, CollectNetworkInfo, ListNetworkInstance, GetNetworkInstanceConfig, ListNetworkInstanceMeta, multi-piece config push, restart/reconnect + re-push |
| `wss.test.ts` | TLS listener + the same stack |
| `tcp.test.ts` | tcp framing + the same stack |
| `secure-mode.test.ts` | `--secure-mode` clients (Noise is mandatory) |
| `plain-fallback.test.ts` | `support_encryption=false` legacy path still works |
| `token-reject.test.ts` | unknown tokens are rejected at heartbeat time and never become devices |

Client version used: `easytier-core 2.6.4-81487c36`, built from the pinned
commit by `scripts/build-test-client.sh`. The official `v2.6.4` release binary
is **not** byte-identical to the pin (different commit) and was therefore not
used.

## 10. M1 control-plane semantics (no wire change)

M1 adds identity, approval and desired state **on top of** the M0 channel. The
bytes on the wire are unchanged; this section records how the server uses them.

### 10.1 Invite token is the config-server token

Invites are created by the panel and their plaintext is shown once. Only
`sha256(token)` is stored. The token is placed in the config-server URL:

```
easytier-core --config-server wss://host/<invite-token> --hostname my-device
```

The client percent-decodes the last path segment and sends it as
`HeartbeatRequest.user_token`; over `tcp` the path is cleared before dialling,
so the heartbeat field is the authoritative source (§2). The server resolves
the hash to an invite, the invite to a network, and `(network, machine_id)` to
a device. [verified — conformance m1.test.ts]

- Unknown token → RPC error at heartbeat time; the client logs
  `config-server heartbeat failed`, tears the session down and retries every
  second. The server rate-limits unknown tokens per source IP and closes the
  link once the window is exceeded. [verified]
- Expired/exhausted/revoked invites cannot create **new** devices, but the
  token remains usable for an already-registered device of that invite (it is
  the only credential a deployed client has; revoking must not silently kick
  the fleet). [verified for exhausted/revoked]
- `--hostname` and `--machine-id` are the upstream CLI flags
  (`easytier/src/core.rs`), verified in the pinned source.

### 10.2 Enrollment and approval

A new `machine_id` becomes a `pending` device with hostname, EasyTier version,
OS info and source IP from the heartbeat, plus the invite used. Pending devices
receive **no** `WebClientService` calls and run nothing: the conformance test
queries `ListNetworkInstance` on the real client and gets an empty list.
[verified]

Approval allocates an address from the network CIDR, creates revision 1 of the
desired config (`source = approval`) and schedules a push. Blocking and
deleting call `DeleteNetworkInstance` for the deterministic instance id before
closing the session, then refuse heartbeats. [verified — the client logs the
heartbeat rejection and never receives config again]

### 10.3 Deterministic instance id

One EasyTier instance per `(network, device)`. Its UUID is derived as
`sha256("easyplane.network-instance" || networkId || deviceId)` formatted as a
v5-shaped UUID. The same id is used for `RunNetworkInstance`,
`CollectNetworkInfo`, `GetNetworkInstanceConfig` and `DeleteNetworkInstance`,
so the server can verify or stop exactly the instance it owns. [verified]

### 10.4 Desired vs applied, idempotent push

The desired config is stored per device as an append-only revision. The
EasyTier `network_secret` is **not** stored in revision rows: it lives on the
network row (AES-256-GCM) and is merged in when a config is built.

Push path:

1. `RunNetworkInstance{inst_id, config, overwrite=true, source=ConfigSourceWeb}`
   with a 20 s RPC timeout. [verified]
2. Poll `CollectNetworkInfo([inst_id])` until `running = true` or
   `error_msg` is reported (max ~6 s). [verified]
3. Record `applied_revision` and clear the error, or store `last_push_error`.

On every reconnect/heartbeat where applied < desired (or after a failure) and
periodically while online, the server verifies `ListNetworkInstance` +
`GetNetworkInstanceConfig` and re-pushes only when the instance is missing or
the reported config diverges. The comparison is **semantic**, because upstream
normalises the config: `networkingMethod` (Standalone comes back as Manual),
build defaults (`bindDevice`, `multiThread`) and other fields are ignored; the
network name/secret, hostname, DHCP/IPv4/prefix, `noTun`, MagicDNS and peer URLs
are compared. [verified — revision 2 and rollback revision 3 are read back from
the real client]

Rollback is append-only: restoring revision *n* creates a new revision with a
copy of that content and `rollback_of_revision = n`. [verified]

`RetainNetworkInstance` is not part of the push path (see §8).

## 11. M2: policy, MagicDNS and routes on the wire (no new RPC)

M2 adds no method and no message: everything rides in the `NetworkConfig`
pushed by `RunNetworkInstance`, and everything the panel learns comes back from
`GetNetworkInstanceConfig` / `CollectNetworkInfo`. Details derived from
`easytier-core/src/config/api_input.rs` are listed below because they change
what a control plane may assume.

### 11.1 Fields used by the M2 compiler

| NetworkConfig field | EasyTier effect | Notes |
| --- | --- | --- |
| `acl` (`acl.Acl`) | `cfg.set_acl(...)`, applied to the instance's `AclFilter` | ignored when `Acl::is_empty()`; always send chains. Rules are sorted by descending `priority`, first match wins. `ports` are destination ports, `source_ports` are source ports; port criteria only apply when the packet carries a port, so an `Any`-protocol rule with ports also matches ICMP. |
| `proxy_cidrs` | subnet router (`--proxy-networks`); advertised to peers | `"real"` or `"real->mapped"`. Advertisements are visible in *other* peers' `CollectNetworkInfo` routes. |
| `enable_exit_node` | `--enable-exit-node` | reported back by `GetNetworkInstanceConfig`. |
| `routes` + `enable_manual_routes` | install routes towards the overlay (`--manual-routes`) | `gen_config` applies an empty list (`manual_routes = Some([])`), which installs nothing. `new_from_config`/`network_config_from_toml` at the pin report the flag only when the list is **non-empty**, so "manual routes with an empty list" reads back as flag absent + `routes: []`; the panel's drift comparison accounts for it. |
| `enable_magic_dns` | `flags.accept_dns` (`dns_server`) | zone is **not** in NetworkConfig; see §11.3. |
| `hostname` | instance hostname; becomes the MagicDNS record name | EasyPlane pushes the device's unique DNS name. |

### 11.2 Peer URLs need a non-Standalone networking method [verified]

`gen_config` applies `peer_urls`/`peers` only inside the `PublicServer` and
`Manual` branches; a `Standalone` instance silently ignores them. A config that
lists peers while asking for `Standalone` therefore never forms a mesh.
EasyPlane compiles `peer_urls` + `Standalone` as `Manual`.

The client's `new_from_config` reports the peer list as `Url::to_string`, which
appends a trailing `/` (`tcp://host:11010/`); drift comparison must normalise it.

#### Compiled peer list: hubs, raw URLs and self-dialling [verified]

`peer_urls` is resolved **per device at push time** from the network's ordered
peer list (`network_peers`), not stored verbatim in the revision. A revision's
`config.peerUrls` is still accepted and recorded for older clients/rollbacks,
but the push compiler replaces it:

1. a **device-backed** entry contributes every advertised endpoint of an
   **approved hub** (`devices.is_hub`), except the target device itself —
   matched by `device_id` and re-checked by `machine_id`;
2. a **raw** external entry (`url` set) is pushed verbatim to every device,
   unless it is linked to the target device (`network_peers.device_id`), in
   which case only the target skips it;
3. invalid URLs (scheme outside `tcp/udp/ws/wss/quic/wg/faketcp/ring/txt/srv/
   unix/http/https`, no host where one is required) are dropped; entries are
   de-duplicated by URL ignoring trailing slashes and keep peer-list order.

Consequences: a device that is the only hub gets `peer_urls: []` (it is the
listener); a hub never receives its own public URL and therefore cannot dial
itself and loop with `peer id conflict, are you connecting to yourself?`. The
list is network state like routes and MagicDNS: changing an endpoint repushes
the devices that dial it (no new revision, audited, SSE `network.updated`), and
rollback does not resurrect a stale peer list.

Advertised endpoints are written explicitly by an operator. Nothing is inferred
from DNS or IPs; a raw URL is only linked to a device on an **exact string
match** with one of that device's endpoints, and linking converts it into a
device-backed entry.

### 11.3 `tld_dns_zone` cannot be pushed [source, verified in the negative]

`NetworkConfig` has no zone field and `gen_config` builds the instance flags
from defaults, so a config-server-managed instance always serves the default
zone `et.net.` — a client started with `--tld-dns-zone other.test.` still
answers in `et.net.` for the pushed instance. The panel therefore treats the
per-network zone as a naming/UI setting and warns about the client-side flag.
`dig +short core-a.et.net @100.100.100.101` inside a real client returns the
peer's virtual IP. [verified]

### 11.4 Route reports

- `CollectNetworkInfo([])` returns every instance in the process (empty
  `inst_ids` means "all"); `CollectNetworkInfo([id])` filters.
- Each `api.instance.Route` is a **peer** entry (`peer_id`, `ipv4_addr`,
  `hostname`, `proxy_cidrs`); `route_table.list_routes` skips `my_peer_id`, so a
  device's own advertisement is never in its own list. The control plane reads
  it from the other members' reports and attributes it by virtual IP.
- `GetNetworkInstanceConfig` returns the instance's current config
  (`proxy_cidrs`, `enable_exit_node`, `acl`, ...) and its `ConfigSource`
  (`ConfigSourceWeb` for everything EasyPlane pushed).
- `GetNetworkInstanceConfig` fails with `instance config control not found`
  while an instance is being (re)created by `RunNetworkInstance`; callers must
  tolerate a short window of errors. [verified]
- `DeleteNetworkInstance` only works while the client is connected; a
  file-backed instance (`-c`/`-f`) is `READ_ONLY|NO_DELETE` and a separate
  process is invisible to the control plane.

### 11.5 What M2 verified with three real clients

`test/conformance/m2.test.ts` (three containers, isolated bridge network, each
with its own TUN):

- a compiled ACL arrives via `RunNetworkInstance`, the client logs
  `ACL rules built: 1 inbound, 0 outbound, 0 forward`, an allowed TCP flow
  returns 200 and a denied port times out in both directions;
- MagicDNS resolves a peer name on a client;
- a pending subnet route is absent from the pushed config, an approved one is
  pushed and reported back, an extra non-managed instance advertising a route
  shows up as an unapproved/unknown peer, and exit-node approval flips
  `enable_exit_node`.

The containers reach the vitest-hosted listener through a test-only TCP relay
because this host drops traffic from Docker bridges to host ports; the
WebSocket, Noise upgrade and RPCs are end-to-end. See the test header.

## 12. M3: topology and live status (no new RPC)

M3 adds no method and no message on the config-server channel. The map is built
from the same `CollectNetworkInfo` response M2 already uses, read field by
field. This section records which fields are authoritative, because several are
easy to misread.

### 12.1 What is probed

- One `CollectNetworkInfo([inst_id])` per approved, **online** device, for the
  deterministic instance id (§10.3). Offline devices are nodes with
  `online: false` and no edges; they are not probed.
- Collection is adaptive and bounded (`EASYPLANE_TOPOLOGY_*`, see
  [docs/REALTIME.md](REALTIME.md) §5), independent of the route-report interval.
- The response is not persisted. The latest snapshot per network lives in
  memory and is replaced atomically.

### 12.2 Authoritative fields

| fact | field | note |
| --- | --- | --- |
| direct vs relayed | `routes[].cost`; `peers[].directly_connected_conns` | `cost == 1` is what EasyTier's CLI prints as `DIRECT` (`easytier/src/easytier-cli.rs`); a peer with a direct connection is direct even before the route table catches up. |
| relay node | `routes[].next_hop_peer_id` | Resolve it within the *same* response; peer ids are per instance. |
| tunnel protocol | `peers[].conns[].tunnel.tunnel_type` | Raw values include `tcp`, `tcp6`, `udp`, `ws`, `wss`, `quic`, `wg`, composite prefixes like `txt-tcp` and, occasionally, a full URL (`display_tunnel_type` in `easytier-proto/src/common.rs`). |
| RTT | `conns[].stats.latency_us` (µs) | Prefer the default connection (`peers[].default_conn_id`), then the minimum; same rule as `PeerRoutePair::get_latency_ms`. |
| loss | `conns[].loss_rate` (0..1) | Set by the liveness ping (`loss_rate_stats / 100.0`); only known for a direct connection. |
| direction | `conns[].is_client` | `true` when this side dialled (`do_handshake_as_client`), so the map shows dialler/acceptor, not a guess. |
| public endpoint | `conns[].tunnel.{remote_addr,resolved_remote_addr}` | The observed underlay address. |
| NAT type | `my_node_info.stun_info` / `routes[].stun_info` | Enum names from `common.NatType` (`OpenInternet`, `NoPAT`, `FullCone`, `Restricted`, `PortRestricted`, `Symmetric`, …). |
| public IPs | `my_node_info.stun_info.public_ip` | **Only** populated for the local node. `routes[].stun_info` carries NAT types but no public IP list (`RoutePeerInfo` has no such field), so peers' public addresses come from their connection endpoints. |
| listeners, version, proxy CIDRs | `my_node_info.listeners`, `routes[].version`, `routes[].proxy_cidrs` | As reported; not normalised by the control plane. |
| route path latency | `routes[].path_latency` (ms) | Used for a relayed edge; a relayed path has no per-connection loss. |
| public-server hint | `routes[].feature_flag.is_public_server` | Upstream sets this flag in foreign-network contexts; it is a hint, not a reliable "this is a public server" marker. |

### 12.3 Derivation rules (implemented, unit-tested from real wire bytes)

- Canonical node id = the overlay IPv4 (`ip:<addr>`), because peer ids are
  assigned per instance and are not comparable across observers. A peer without
  a route entry gets `peer:<observer>/<peer_id>` until the route table converges.
- Direct if `directly_connected_conns` is non-empty or `cost == 1`; otherwise
  relayed with `via = next_hop_peer_id`.
- Edges are merged from both sides' reports. A relayed edge's `protocol` is the
  first hop's tunnel (`protocolIsFirstHop = true`); the path itself can mix
  transports, and the map says so.
- If the two sides disagree (one direct, one relayed) the link is
  `asymmetric`; both observations are kept in `evidence`.
- `reachable` = open/static NAT (`OpenInternet`/`NoPAT`) or the public-server
  flag. `relayCapable` = reachable **or** actually used as a next hop by another
  node. Reasons are returned with the node; no badge without evidence.

### 12.4 Verified against real clients

`test/conformance/m3.test.ts` (three real clients, hub-and-spoke, `disable_p2p`
on both leaves):

- `core-b`'s own `CollectNetworkInfo` reports `core-c` with `cost = 2` and
  `next_hop_peer_id = core-a`; the derived snapshot matches (relayed edge via
  `core-a`, cost 2, first-hop `tcp`, `relaying-for` on the hub).
- Direct edges report `tcp`, real RTT/loss, dialler/acceptor and the underlay
  address; NAT type and listeners are the client's STUN/listener data.
- The map flags no node as reachable in the Docker bridge (NAT is not open) and
  highlights the hub only because it demonstrably relays.
- Offline/online transitions reach the browser over SSE; the stream is refused
  without a session and above the per-user cap.
- ICMP between the leaves still crosses the relay while collection runs.

The captured protobuf bytes of that run are the unit-test fixture
(`apps/server/test/fixtures/easytier/collect-network-info-m3.json`), so the
derivation tests decode exactly what the real client sent.

### 12.5 Not claimed

- No `ListPeer`/`ListRoute` RPC is called: those are exposed on the client's
  *instance* RPC service (different channel), and `CollectNetworkInfo` already
  contains the same route/peer data. Nothing here implies the control plane can
  drive an instance RPC portal.
- A separate local `easytier-core` process is invisible (same limitation as
  §11.4/§11.5).
- The browser stream is a control-plane feature; there is no EasyTier wire
  change and no new client capability.

## 13. M4: UDP transport, imports and hardening

### 13.1 UDP config-server transport [verified]

Sources: `easytier-core/src/packet/mod.rs` (`UDPTunnelHeader`,
`UdpPacketType`), `easytier-core/src/socket/udp/{packet,layer,session}.rs`,
`easytier-core/src/connectivity/transport/udp.rs` (client dial).

One UDP datagram carries:

```
+-------------+---------+---------+-------+--------------------------+
| conn_id u32 | msg u8  | pad u8  | len   | payload (len bytes)      |
|             |         |         | u16   |                          |
+-------------+---------+---------+-------+--------------------------+
```

All integers are **little-endian** (`DefaultEndian = LittleEndian`). Messages:

| value | message | payload |
| --- | --- | --- |
| 1 | `SYN` | 8 random bytes (`magic`) |
| 2 | `SACK` | the same 8 bytes |
| 3 | `DATA` | exactly one tunnel payload: 16-byte peer-manager header + RPC bytes |
| 4 | `FIN` | empty |

Handshake and session identity:

1. The dialler picks a random `conn_id` and `magic`, sends `SYN`, and resends
   it every `UDP_SESSION_RESEND_INTERVAL` until it receives a `SACK` with the
   same conn id and magic (`pending_connects`).
2. The acceptor replies `SACK` from the listener socket. The session is keyed
   by `(source address, source port, conn_id)`; **both directions use the
   dialler's conn id** — there is no reverse id.
3. `DATA` in both directions is the same payload TCP frames carry after their
   4-byte length prefix. `FIN` (or a socket error) closes the session.
4. A retransmitted `SYN` for an existing session is answered with `SACK`
   again; it never allocates a second session. `DATA` without a session gets
   `FIN`. Sessions are only created by a valid `SYN`, so random datagrams
   cannot allocate state.

EasyPlane's listener additionally caps concurrent sessions
(`EASYPLANE_MAX_CLIENT_CONNECTIONS` still applies at the control-plane layer),
sweeps sessions with no datagrams for 2 minutes, and the normal heartbeat
reaper closes a tunnel whose device stops heartbeating.

Verified with real clients: `test/conformance/udp.test.ts` runs
`easytier-core 2.6.4-81487c36` over `udp://…/token-udp` and asserts the Noise
upgrade (`secure=true`), heartbeats, `ValidateConfig`, `RunNetworkInstance`,
`CollectNetworkInfo`, `ListNetworkInstance` and `GetNetworkInstanceConfig`.
`apps/server/test/unit/udp-listener.test.ts` pins the header/handshake bytes
independently.

The UDP listener is **opt-in** (`EASYPLANE_UDP_PORT`); `ws`/`wss`/`tcp` remain
the default deployment.

### 13.2 Import formats [verified by unit goldens + real device adoption]

Three sources produce the same normalised `api.manage.NetworkConfig`:

**EasyTier TOML** (`easytier-core/src/config/toml.rs`, `struct Config`):

```toml
instance_name = "..."
instance_id = "..."
hostname = "..."
ipv4 = "10.144.144.10/24"      # a bare address defaults to /24 upstream
dhcp = false
listeners = ["tcp://0.0.0.0:11010"]

[network_identity]
network_name = "my-net"
network_secret = "..."          # must be preserved byte-for-byte

[[peer]]
uri = "tcp://public.example.com:11010"
peer_public_key = "..."         # accepted, but not represented in EasyPlane

[[proxy_network]]
cidr = "10.0.0.0/24"
mapped_cidr = "192.168.1.0/24"
allow = ["tcp"]                 # dropped: NetworkConfig has no allow list

[[port_forward]]
bind_addr = "0.0.0.0:11011"
dst_addr = "192.168.1.10:11011"
proto = "tcp"

routes = ["10.1.0.0/16"]
exit_nodes = ["10.144.144.5"]

[flags]                         # snake_case FlagsInConfig names
no_tun = true
accept_dns = true
mtu = 1300
relay_network_whitelist = "net-a net-b"

[secure_mode]
enabled = false
```

The TOML reader accepts unknown top-level keys (upstream `Config` does too),
maps the fields above, reports everything it cannot represent (proxy CIDRs,
exit nodes, ACL, credentials, port forwards, VPN portal, IPv6, custom STUN,
whitelists) and refuses credential mode. `peer_urls` and `[[peer]]` URLs are
kept as **raw network peer entries** and pushed to every device as before; the
preview lists them, and adopting from a device proposes an exact-match link to
any device that already advertises the same endpoint (see §11.2.1). The writer
produces a file that the upstream loader parses; a golden test round-trips the
upstream full example in both directions.

**Share link** (`easytier-contrib/easytier-ohrs/src/config/services/share_link_service.rs`):

```
https://easytier.cn/comp_cfg?cfg=<payload>&name=<display>&only_start=true
payload = base64url_no_pad( zlib( JSON ) )
JSON    = pbjson(api.manage.NetworkConfig) with every *top level* key replaced
          by its proto field number as a decimal string
```

Details that matter:

- nested messages keep **snake_case** pbjson names (`peer_public_key`,
  `local_private_key`), enums are names (`"Manual"`), 64-bit integers are
  strings, `bytes` are base64;
- only the top level is remapped (`"6"` instead of `"network_name"`); empty
  arrays and `null` are pruned;
- upstream only accepts `https://easytier.cn/comp_cfg`, EasyPlane also accepts
  the same path on another host (documented) and a raw `cfg=` payload;
- zlib output is bounded to 1 MiB on decode to stop decompression bombs.

`apps/server/test/unit/import-config.test.ts` checks the field-number map
against the pinned `api_manage.proto`, decodes a hand-built GUI-shaped link and
round-trips a config with an ACL in both directions.

**Running device** (`WebClientService.GetNetworkInstanceConfig`, §6.2). The
panel lists the device's instances, calls the RPC and maps the returned
`NetworkConfig` the same way. The instance id and hostname are device-specific
and are dropped; the network name, secret and non-secret defaults are kept.
`test/conformance/m4-import.test.ts` exercises this against a real client.

### 13.3 What import preserves and what it does not

Preserved: `network_name`, `network_secret` (encrypted at rest and never sent
to the browser during preview), addressing method/prefix, DHCP flag, peer and
listener URLs, MTU, `no_tun`, P2P/latency flags, manual routes/accept-routes,
and the MagicDNS switch.

Not imported because EasyPlane owns the value through a workflow: proxy CIDRs
and exit nodes (route approvals), ACL/credentials (policy document), port
forwards, VPN portal, mapped listeners, IPv6/STUN/whitelist settings. The
preview lists every dropped item; nothing is silently discarded.

### 13.4 Hardening on the channel

- Per-IP tunnel admission limiter, simultaneous-connection cap and a heartbeat
  reaper for half-open/quiet sessions (§2). [verified in unit tests]
- Unknown-token limiter; pending-device cap per network. [verified]
- All browser/API rate limits (global + per-route) and CSRF/role checks are
  enforced server-side; see docs/DEPLOY.md §5.
- Optional Prometheus `/metrics` (bearer token on the app or an internal-only
  listener) exposes counts only: sessions, heartbeats, pushes, topology cycles,
  imports, SSE streams. It never contains a network/device name, token or
  secret.

## 14. Bundled rendezvous node (source-level proof and limits)

EasyPlane can run a stock `easytier-core` as a **public node**: a peer that
helps devices find each other and coordinates NAT hole punching. The panel
never implements EasyTier routing itself; it only appends the node's peer URLs
to a network's compiled list. This section records what the pinned core
actually does, with file citations, and what was verified against real
containers. [source: pinned commit `81487c363a…`, version `2.6.4-81487c36`]

### 14.1 How a public node serves foreign networks

A node whose own `network_name` differs from a peer's is a **public server** for
that peer's network. `easytier-core/src/peers/foreign_network/mod.rs` creates one
foreign-network instance per admitted network (`build_foreign_peer_context`,
`PUBLIC_SERVER_HOSTNAME_PREFIX = "PublicServer_"`), and
`PeerManager::add_tunnel_as_server_with_origin`
(`easytier-core/src/peers/peer_manager.rs` ~L2080–2160) decides admission. The
foreign instance carries the peers' network identity and its own synthetic
hostname, so leaves see it as `PublicServer_<node-hostname>` in
`CollectNetworkInfo`/`easytier-cli route`.

A public node does all of the following for an admitted foreign network:
initial contact and peer discovery, peer RPC/OSPF route exchange, route
selection and hole-punch coordination, plus control-plane liveness. It forwards
**data-plane** packets only when relay is allowed (14.2). [verified in
`test/conformance/rendezvous.test.ts`: leaves on disjoint Docker networks see
each other through the node with `cost=2` / `next_hop=PublicServer_…` while an
HTTP request times out]

> The conformance leaves make their own isolation explicit: each isolated leaf
> installs `prohibit` routes for the *other* leaf's docker addresses
> (`test/conformance/rendezvous/leaf-entrypoint.sh`) before `easytier-core`
> starts, and the test asserts the underlay is unreachable. "Disjoint Docker
> bridges cannot reach each other" is the docker daemon's
> `DOCKER-ISOLATION-STAGE-*` state, not a property of the node; when a runner
> does not apply it, two leaves pair directly (`cost=1`) and relay OFF passes
> traffic for a reason unrelated to the relay flag. The suite therefore measures
> the node, not the host's iptables.

### 14.2 `disable_relay_data`: rendezvous only

`FlagsInConfig.disable_relay_data` (`easytier-proto/proto/common.proto` field
41) makes the node drop forwarded data:

- `PeerManager::should_drop_relay_data` (`peer_manager.rs` ~L3250) and
  `try_handle_foreign_network_packet` (~L3020) drop data-plane packets;
- `foreign_network/mod.rs` (~L1330) drops them inside a foreign instance when
  `!relay_data || disable_relay_data`;
- the flag is also advertised as `PeerFeatureFlag.avoid_relay_data`
  (`peers/context.rs` ~L140) and becomes `PeerPolicyConfig.relay_data = false`.

The flag is **not a CLI switch** in the pinned build. It is reachable through
the TOML `[flags]` table and the management API
(`easytier-core/src/config/toml.rs`, `api_input.rs`), which is why the bundled
image renders a TOML file from environment variables instead of passing a flag.
The official `easytier/easytier:v2.6.4` image predates the field; the deployment
image uses `v2.7.0` (14.6) while conformance runs the pinned build.

What still works with `disable_relay_data=true`: admission, peer RPC, OSPF and
hole punching. Two leaves behind the same reachable LAN still connect
**directly**, and that is the intended default. [verified: HTTP 200 between two
leaves with relay off, route `cost=1`; a third isolated pair got HTTP 000]

### 14.3 `private_mode`: the shared-secret gate

`FlagsInConfig.private_mode` (`common.proto` field 23) is the who-may-use-it
gate. In `add_tunnel_as_server_with_origin` (`peer_manager.rs` ~L2127):

```text
if !is_local_network && private_mode && !foreign_network_allowed {
    return Err(SecretKeyError(
        "private mode is turned on, foreign network secret mismatch"));
}
```

`foreign_network_allowed` is `conn.matches_local_network_secret()` or a trusted
credential pubkey. `matches_local_network_secret`
(`peers/conn/peer_conn.rs` ~L1449) accepts either:

1. a **secret proof**: HMAC-SHA256 keyed by the peer's `network_secret` over the
   Noise handshake hash (`secret_proof_from_secret`, `peers/context.rs` ~L730);
2. an equal `network_secret_digest`. That digest is
   `DefaultHasher(network_name || network_secret)`
   (`easytier-core/src/config/mod.rs` ~L203), so it **changes with the network
   name**.

Two consequences, both verified:

- A leaf with a **different secret** is rejected with the message above, even
  when it uses the same network name. [verified: `core-rv-wrong-secret` in the
  conformance suite, node log assertion]
- A leaf with the **same secret but a different network name** is admitted only
  if the proof path is available. That path requires **secure mode**: the client
  performs the Noise secret proof only in
  `do_noise_handshake_as_client` (`peer_conn.rs` ~L789, called only when
  `is_secure_mode_enabled()`; the legacy handshake in ~L1256 sends no proof).
  [verified: same secret + different name is **rejected** without secure mode,
  and accepted with `--secure-mode true` on both sides]

This is why the panel pushes `secure_mode: { enabled: true }` to every device in
a network that opts into the bundled node (`normalize_secure_mode_config`
generates the X25519 keypair client-side). The node's own entrypoint enables
secure mode by default. It is a real, documented dependency, not a knob.

The model is therefore **one shared secret per rendezvous node**: networks keep
their own `network_name` (EasyTier isolates them as separate foreign networks)
but must use the node's `network_secret`. The panel can verify this when
`EASYPLANE_RENDEZVOUS_SECRET` is set and offers an explicit, audited
"align network secret" action; otherwise the UI requires an acknowledgement.
`private_mode=false` is an explicit opt-out for a truly open node and removes
the gate entirely (14.7).

### 14.4 `relay_network_whitelist` and `relay_all_peer_rpc`

`FlagsInConfig.relay_network_whitelist` is a space-separated list of wildcard
network names (`peers/whitelist.rs`); the default is `*`
(`config/toml.rs` `gen_default_flags`). In `ForeignNetworkManager::add_peer_conn`
(`foreign_network/mod.rs` ~L900) a foreign network outside the list is
**rejected outright** unless `relay_all_peer_rpc = true`. The same
`relay_data` boolean is then passed to the foreign instance, which drops
data-plane packets when false. So:

- with the default (`relay_all_peer_rpc=false`), the whitelist is an **admission
  allow-list** (who may use the node at all);
- with `relay_all_peer_rpc=true`, non-whitelisted networks may still rendezvous
  and exchange peer RPC, but only whitelisted networks get data relay — a
  second layer that restricts relay without breaking discovery.

[verified: with whitelist `not-this-network`, the node log says
`network … not in whitelist` and the pair cannot communicate; with
`relay_all_peer_rpc=true` the connections stay up and peer routes appear, while
the HTTP request still times out]

`relay_all_peer_rpc` also matters for credential-mode/other peers: the upstream
help says it helps peers outside the whitelist establish P2P.

### 14.5 `p2p_only`

`FlagsInConfig.p2p_only` (`common.proto` field 32) makes
`PeerManager::check_p2p_only_before_send` (`peer_manager.rs` ~L2561) fail every
send to a peer that is not already a direct peer. It is a device-side switch,
not a node switch: a network can push it to every device to forbid relay
fallback. The panel exposes it as an advanced, per-network toggle and warns
that symmetric NAT/CGNAT combinations then cannot connect at all.

### 14.6 Image and version choice

| use | image | why |
| --- | --- | --- |
| conformance node | `easyplane/easytier-core-test:2.6.4-81487c36` built by `scripts/build-test-client.sh` | byte-identical to the panel pin; the only way to test the exact `disable_relay_data`/private-mode behaviour |
| deployment node | `easytier/easytier:v2.7.0` (override `RENDEZVOUS_IMAGE`) | stock, multi-arch, contains the same `private_mode`, `disable_relay_data`, `relay_network_whitelist`, `relay_all_peer_rpc` fields (checked against tag `8b7f1f01`); no local Rust build and no vendored binary. Manually exercised with pinned leaves: private mode admits the right secret, relay off drops data, relay on passes it, healthcheck `easytier-cli node` works |

The panel pin and the deployment node are **not the same commit**. The
rendezvous role uses only the public-server handshake/RPC subset that exists in
both; the panel's own config-server compatibility is still the pinned contract
(docs/COMPATIBILITY.md). A deployment that wants byte-identical versions can
point `RENDEZVOUS_IMAGE` at its own image built from the pin.

### 14.7 Honest limits

- Hole-punch assistance was verified on Docker bridge networks with real
  clients, not on carrier NAT. The test proves "the node coordinates discovery
  and does/does not forward data"; it is not a NAT-lab matrix.
- The secret is a shared symmetric key. Anyone who obtains it can join the node
  as an admitted foreign network (with their own network name) and consume its
  rendezvous/relay capacity. There is no per-network quota except
  `foreign_relay_bps_limit` (not exposed by the entrypoint) and no revocation
  list. Rotating the secret means changing `RENDEZVOUS_NETWORK_SECRET` **and**
  every network's secret, then repushing.
- Private mode authenticates the **network**, not the individual device. A
  leaked network secret is a leaked node credential.
- `private_mode=false` is an open public node: anyone can use it, and with
  `RENDEZVOUS_RELAY_DATA=true` anyone can relay traffic through it. Do not
  combine the two on an untrusted host.
- The node does not see payload plaintext (EasyTier encrypts peer traffic), but
  it sees connection metadata: network names, peer ids, virtual IPs, timings
  and volume. Relay operators can also observe traffic patterns.
- The map's direct/relayed edge comes from OSPF `Route.cost`/`next_hop_peer_id`
  as reported by each device; it is not an independent probe of the path.

## 15. Credential-mode networks (mode B)

The full design, procedures and measured limits are in
[docs/CREDENTIALS.md](CREDENTIALS.md). On the wire nothing new is called: the
difference is entirely in the pushed `NetworkConfig`.

**Member** [verified with the real client]:

```text
networkSecret   = absent            # `gen_config` then builds a name-only
                                    # NetworkIdentity (NetworkIdentity::new_credential)
secureMode      = { enabled: true, localPrivateKey: base64(32-byte X25519 key) }
managedCredentials = []             # members never publish a trust list
```

**Anchor** [verified]:

```text
networkSecret   = <the network secret>
secureMode      = { enabled: true }
managedCredentials = every active member credential
```

`managed_credentials` entries carry the member's **private** key
(`credential_secret = base64(X25519 private)`), its ACL `groups`, `allow_relay`,
`allowed_proxy_cidrs`, `expiry_unix` and `reusable`. The anchor publishes the
derived public keys over OSPF as `TrustedCredentialPubkeyProof`, HMAC-SHA256
signed with the network secret (`peer_rpc.rs`); anchors verify, a public node
accepts them from a secret-verified anchor (`foreign_network/mod.rs`). This is
why a rendezvous node admits a credential member only while the network is
established there by an anchor.

`WebClientService` has no config-patch method, so changing
`managed_credentials` means a full `RunNetworkInstance` (the anchor instance
restarts briefly) [source: `management/full/process_rpc.rs`]. `GetNetworkInstanceConfig`
reports `managedCredentials` and the derived `secureMode.localPublicKey`, which
is what the push compiler compares to detect revoke/renew drift.

