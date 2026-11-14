# EasyPlane

Control plane for [EasyTier](https://github.com/EasyTier/EasyTier): a new
config server + web panel that speaks the **real EasyTier wire protocol**, so
unmodified `easytier-core` clients (`--config-server`, Android JNI) can connect
and be managed. It is not a fork of `easytier-web`; only the wire protocol is
kept compatible.

Status: **M0 (protocol spike + conformance harness)**. The server accepts,
authenticates, pushes configs to, and reads state from real `easytier-core`
clients over `ws`, `wss` and `tcp`, including the Noise "web-secure" tunnel.
The database, auth and UI land in M1.

- Protocol documentation: [docs/PROTOCOL.md](docs/PROTOCOL.md)
- Brief and user stories: [docs/BRIEF.md](docs/BRIEF.md), [docs/USER_STORIES.md](docs/USER_STORIES.md)

## Layout

```
apps/server        TypeScript control plane (tunnel + RPC + WebServerService)
apps/web           placeholder (M1)
packages/proto     generated ts-proto bindings for the pinned upstream protos
packages/shared    shared helpers (UUID <-> protobuf)
proto/easytier     verbatim copy of easytier-proto/proto at the pinned commit
test/conformance   vitest suite driving real easytier-core containers
docker             conformance client image
scripts            proto sync/check, test-client build
```

## Quick start

Requires Node 22+, [Bun](https://bun.sh) (workspace install only — the runtime
is Node), `protoc` for binding regeneration.

```bash
bun install
bun run typecheck
bun run test:unit

# Run the control plane (ws on 22023, tcp on 22020)
bun run dev

# Point a real client at it
easytier-core --config-server ws://127.0.0.1:22023/dev-token --hostname dev
```

Environment: `EASYPLANE_HOST`, `EASYPLANE_WS_PORT`, `EASYPLANE_TCP_PORT`,
`EASYPLANE_WSS_PORT` + `EASYPLANE_TLS_CERT`/`EASYPLANE_TLS_KEY`,
`EASYPLANE_TOKENS` (comma-separated; empty accepts any token — M0 only),
`EASYPLANE_SECURE=off` (debug/legacy: advertise no web-secure support),
`EASYPLANE_LOG_LEVEL`.

`wss://` termination is built in (self-signed works — EasyTier clients do not
verify the config-server certificate), so a reverse proxy is optional.

## Protobuf sync

```bash
scripts/sync-protos.sh 81487c363a56779e745eae927e130a813535c71e
scripts/check-protos.sh          # CI: fails on drift
```

Only `easytier-proto/proto/*.proto` is copied from upstream; the commit and
source path are recorded in `proto/easytier/UPSTREAM_REF`.

## Conformance suite

The suite proves M0 (a)–(f) against a **real, unmodified** `easytier-core`
built from the pinned commit — never a fake client.

```bash
scripts/build-test-client.sh        # builds easytier-core into docker/easytier-core/
docker compose -f docker-compose.test.yml --profile test build
bun run test:conformance
```

The containers use host networking (`127.0.0.1`) plus `/dev/net/tun` and
`CAP_NET_ADMIN`, so the suite is Linux-only. Set
`EASYPLANE_CONFORMANCE_NO_TUN=1` to push a `no_tun` config (useful without TUN
privileges). `stopAllCores()`/`docker compose down` run in `afterAll`.

## Security posture (M0)

The M0 listener is a protocol spike, not a hardened service: it has no
authentication beyond an allow-list of config-server tokens and no rate
limiting. `EASYPLANE_TOKENS` should be set even in a lab, and the ports should
not be exposed publicly. M1 adds invites, per-device approval, hashed tokens,
rate limits and the API auth model.
