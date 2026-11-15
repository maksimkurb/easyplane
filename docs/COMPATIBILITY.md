# EasyTier compatibility

EasyPlane talks the EasyTier config-server wire protocol; it does not vendor
Rust code and is not a fork of `easytier-web`. This page records exactly which
client versions have been exercised, what the compatibility contract is, and how
to move to a new upstream ref.

Pinned reference:

```
commit  81487c363a56779e745eae927e130a813535c71e   (2026-08-24)
version 2.6.4-81487c36
```

## Tested versions

| client | how it was obtained | transports | result |
| --- | --- | --- | --- |
| `easytier-core 2.6.4-81487c36` | built from the pinned commit by `scripts/build-test-client.sh` (real upstream code, unmodified) | `ws`, `wss`, `tcp`, `udp` | full conformance suite green |
| `easytier-core 2.6.4-81487c36 --secure-mode` | same binary | `ws`, `udp` | Noise handshake mandatory; green |
| same binary, `GetFeature.support_encryption=false` | test server option | `ws` | legacy plain path; green |
| official `v2.6.4` release tag (`8428a89d`, 2026-05-12) | **not used** | — | different commit than the pin, so not byte-identical; it predates `disable_relay_data` |
| official `v2.7.0` (`8b7f1f01`, 2026-10-05) | `easytier/easytier:v2.7.0` (rendezvous node only) | `tcp` | manual lab: pinned leaves connect through it with private mode + secure mode, relay OFF drops data and relay ON passes it; healthcheck verified. The automated conformance node uses the **pinned** build instead. **Not** a panel config-server support statement |
| Android app / JNI (`easytier-android-jni`) | same upstream web-client code path | — | **source-level only**; not exercised in CI (no device) |

"Green" means `test/conformance/*.test.ts` with real containers: connection,
(Noise), heartbeat/GetFeature, `ValidateConfig`, `RunNetworkInstance`,
`CollectNetworkInfo`, `ListNetworkInstance`, `GetNetworkInstanceConfig`,
`ListNetworkInstanceMeta`, deletion/block, reconnect/re-push, invites,
approval, policy/MagicDNS/routes and topology fields, plus the M4 adoption
flow and UDP session layer.

The **bundled rendezvous node** is the one deliberate exception to "one pinned
binary": the deployment compose runs `easytier/easytier:v2.7.0` because the
official `v2.6.4` image predates `disable_relay_data`. The conformance suite
starts the rendezvous node from the **pinned** build instead, so the behaviour
claimed in PROTOCOL.md §14 is verified on the exact commit. If you need
byte-identical deployments, build an image from the pin and set
`RENDEZVOUS_IMAGE`. The panel's config-server contract still only covers the
pinned client.

## Supported range

The wire protocol is tolerant by design: unknown protobuf fields are ignored on
both sides, and method indexes have been stable since 2.6.x. In practice:

- **Tested**: only the pinned commit above. Treat it as the support statement.
- **Likely compatible**: other 2.6.x clients that keep
  `WebServerService`/`WebClientService`, the 16-byte peer-manager header, the
  web-secure Noise handshake and the RPC framing unchanged.
- **Unknown**: 2.7+/3.x until the conformance suite is re-run against them.
  `CollectNetworkInfo` is the largest moving surface; every field EasyPlane
  reads is listed in [PROTOCOL.md](PROTOCOL.md) §12.2.

The control plane degrades rather than crashes on a newer client:

- unknown protobuf fields are dropped;
- an unparsable/unsupported `NetworkConfig` push is reported in
  `last_push_error`, not retried forever (a new revision is required);
- a client that rejects an RPC is marked `error` in the panel and keeps its
  session; heartbeat rejection makes it retry every second;
- topology/route fields that disappear simply produce fewer edges, and the
  snapshot is marked `partial`.

## Features with a client-side dependency

| feature | requirement | where it is documented |
| --- | --- | --- |
| MagicDNS zone | `tld_dns_zone` is a **client flag**, not `NetworkConfig`; managed clients answer in `et.net.` unless they set `--tld-dns-zone` | PROTOCOL.md §11.3 |
| custom STUN servers | local client flags only; not pushed | PROTOCOL.md §12 |
| subnet routes | `proxy_cidrs` in `NetworkConfig`; the client must have TUN unless `no_tun` | POLICY.md §7 |
| exit node | `enable_exit_node` + peer support | POLICY.md §7 |
| credential-mode networks | `secure_mode.local_private_key` with no `network_secret`; EasyPlane does not push this mode and refuses to import it | PROTOCOL.md §13.2 |
| EasyTier ACL import | compiles from the EasyPlane policy document, not from an imported TOML/ACL | POLICY.md |
| UDP config-server | needs a client built with UDP support (the pinned build is) | PROTOCOL.md §13.1 |
| rendezvous node private mode | **secure mode on both sides**: the shared-secret proof is only sent by the Noise handshake, which the core only performs in secure mode | PROTOCOL.md §14.3, DEPLOY.md §4e |
| rendezvous data relay | `disable_relay_data` is a TOML/management flag, not a CLI flag; `RENDEZVOUS_RELAY_DATA` maps to it | PROTOCOL.md §14.2 |

## Re-syncing to a new upstream ref

`scripts/sync-protos.sh` copies **only** `easytier-proto/proto/*.proto` and
regenerates the TypeScript bindings; no Rust is vendored.

```bash
# 0. Read the upstream diff first. The control plane depends on field numbers,
#    method indexes and defaults, not just names.
git -C /path/to/EasyTier fetch origin
git -C /path/to/EasyTier log --oneline <old>..<new> -- \
  easytier-proto/proto easytier-core/src/management/full \
  easytier-core/src/config easytier-core/src/tunnel easytier-core/src/rpc

# 1. Sync protos + bindings (requires protoc; records the ref in UPSTREAM_REF).
scripts/sync-protos.sh <tag-or-commit>
scripts/check-protos.sh          # must be clean

# 2. Run the unit/golden suites; the share-link field-number map has a drift
#    test against api_manage.proto and will fail if numbers moved.
bun run test:unit

# 3. Build that exact ref and run the real-client conformance suite.
EASYTIER_TEST_REF=<tag-or-commit> scripts/build-test-client.sh
docker compose -f docker-compose.test.yml --profile test build
bun run test:conformance

# 4. Update this page, PROTOCOL.md and the version in README if anything moved.
```

CI runs steps 1 (drift check) and 3 (with the pin recorded in
`proto/easytier/UPSTREAM_REF`), so a proto change cannot land without the
conformance suite seeing it.

## Re-syncing successfully but a client still fails

Check, in this order:

1. **Method indexes** (`easytier-proto/build/rpc.rs` is 1-based) and service
   names — PROTOCOL.md §6.
2. **Tunnel framing** (TCP length prefix, WebSocket one-message-per-frame, UDP
   8-byte session header) — PROTOCOL.md §3 and §13.1.
3. **Web-secure** (`support_encryption`, Noise magic, traffic-key derivation,
   epoch/seq nonce) — PROTOCOL.md §4.
4. **RPC packet shape** (`total_pieces`/`piece_idx`, compression advertisement,
   `transaction_id` echo) — PROTOCOL.md §5.
5. **Normalised `NetworkConfig`** returned by `GetNetworkInstanceConfig`
   (`networking_method` becomes Manual, build defaults appear). The push path
   compares semantically; see PROTOCOL.md §10.4.

If a change cannot be matched on Node, the honest options are the same as in
M0: refuse the feature explicitly, or put a small Rust/Go tunnel front in front
of the Node control plane and forward decoded RPC frames. Nothing here silently
pretends to support a version it has not been tested against.
