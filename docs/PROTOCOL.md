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
  `ring`, `quic`, `wg` … For the control plane only `tcp` and `ws`/`wss` are
  implemented in M0.
- The **token is the last URL path segment**, percent-decoded. An empty token
  is rejected by the client before dialling.
- For non-websocket schemes the client **clears the URL path** before
  dialling, so for `tcp://host:port/<token>` the token never appears on the
  wire; it is only carried in `HeartbeatRequest.user_token`. [verified]
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
| 6 | `DeleteNetworkInstance` | implemented, not required by M0 |
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

## 8. Not implemented in M0 (and why)

- **UDP tunnel** (`udp://`). Requires the EasyTier UDP session layer
  (`SYN`/`SACK`/`DATA`/`FIN` with `conn_id` allocation and per-direction
  connect ids, `udp_tunnel` in `easytier-core/src/socket/udp` + `tunnel/udp.rs`).
  Deferred: the brief puts udp last, and ws/tcp already cover the CLI and the
  Android JNI client.
- **Noise msg3 and Noise transport keys.** EasyTier never uses them; the root
  key from msg2 is the whole contract.
- **Web-secure key rotation on the client side** is handled (we accept up to 3
  epochs ahead and keep a 256-packet replay window); we do not implement the
  `sync_root_key` rekey message because EasyTier's web client never sends one.
- **`RetainNetworkInstance` reconciliation loop.** The method is implemented and
  callable; the periodic "retain what the server still wants" driver belongs to
  M1's desired-state engine.
- **zstd compression of our own RPC bodies.** We always send uncompressed and
  ask the client not to compress responses. Inbound zstd is supported when the
  Node runtime provides `zlib.zstdDecompressSync`.

## 9. How M0 was verified

`test/conformance/*.test.ts` starts the TypeScript control plane on the host
and real `easytier-core` containers from `docker-compose.test.yml`
(`network_mode: host`, `/dev/net/tun`, `CAP_NET_ADMIN`), then asserts:

| test | proves |
| --- | --- |
| `ws.test.ts` | ws accept, Noise upgrade, GetFeature, Heartbeat pacing, ValidateConfig, RunNetworkInstance, CollectNetworkInfo, ListNetworkInstance, GetNetworkInstanceConfig, ListNetworkInstanceMeta, restart/reconnect + re-push |
| `wss.test.ts` | TLS listener + the same stack |
| `tcp.test.ts` | tcp framing + the same stack |
| `secure-mode.test.ts` | `--secure-mode` clients (Noise is mandatory) |
| `plain-fallback.test.ts` | `support_encryption=false` legacy path still works |
| `token-reject.test.ts` | unknown tokens are rejected at heartbeat time and never become devices |

Client version used: `easytier-core 2.6.4-81487c36`, built from the pinned
commit by `scripts/build-test-client.sh`. The official `v2.6.4` release binary
is **not** byte-identical to the pin (different commit) and was therefore not
used.
