# EasyPlane — brief (control plane for EasyTier, Tailscale/Headplane-style)

New independent config server + web panel for EasyTier. NOT a fork of easytier-web; only the EasyTier WIRE PROTOCOL is kept compatible so unmodified easytier-core clients (CLI `--config-server`, Android JNI config-server client) connect and are managed.

## Ground rules
- Derive everything EasyTier-related from real sources. Pinned reference: https://github.com/EasyTier/EasyTier commit 81487c363a56779e745eae927e130a813535c71e. A local clone exists at /home/maksimkurb/Dev/EasyTier (contains that commit; do not modify it). Make your own read-only checkout in a scratch dir (`git clone /home/maksimkurb/Dev/EasyTier <scratch>/easytier-ref && git checkout 81487c3...`). Do NOT vendor Rust code or depend on Rust crates.
- Layout at the pinned commit differs from older docs: look under easytier-web/src/client_manager/{session.rs,managed_config.rs,mod.rs,storage.rs}, easytier/src/web_client/mod.rs (parse_config_server_endpoint), easytier/src/tunnel/**, easytier/src/rpc*/**, easytier-proto/proto/*.proto; use grep for web_security / secure_mode / Noise.
- Only proto files are copied upstream: `proto/easytier/` + `scripts/sync-protos.sh <tag|commit>` + CI check failing on diff.
- Known facts to VERIFY: server side of control channel is tiny (WebServerService: Heartbeat, GetFeature); server then calls client WebClientService (ValidateConfig, RunNetworkInstance, RetainNetworkInstance, CollectNetworkInfo, ListNetworkInstance, DeleteNetworkInstance, GetNetworkInstanceConfig, ListNetworkInstanceMeta) over the same tunnel; last URL path segment = token the client presents; client has machine_id (UUID) + hostname; client reconnects every 1 s, heartbeats every 1 s.
- Don't touch /home/maksimkurb/Dev/keenetic-pbr-go or /home/maksimkurb/Dev/EasyTierCompose (read-only reference). No telemetry, no outbound calls except configured OIDC providers.
- Be honest: separate "verified against real easytier-core" / "implemented from sources" / "not done". Never fake or stub protocol behaviour.

## Stack (decided)
- Backend: TypeScript, Node 22+ (no Bun/Deno-specific runtime APIs). Fastify + zod type provider, OpenAPI from route schemas. Drizzle ORM + drizzle-kit migrations, PostgreSQL. protobuf via ts-proto or protobufjs from the .proto files. bun workspaces: apps/server, apps/web, packages/proto, packages/shared.
- Frontend: React 19 + Vite + Tailwind 4 + shadcn/ui on base-ui (@base-ui/react, style base-nova), TanStack Query, i18next, lucide-react, orval client from OpenAPI. REUSE components/conventions from /home/maksimkurb/Dev/keenetic-pbr-go/frontend/ (components.json, src/components/ui, layout, sidebar, theme/lang providers, auth shell, api layer, orval.config.ts, eslint/prettier). Copy, don't link.
- Realtime to browsers: SSE or WS (justify). Map: @xyflow/react or similar (justify).
- Auth: OIDC only (Auth Code + PKCE), multiple providers, claim/group→role (admin/member/viewer). No local passwords. One break-glass bootstrap admin token via env, disabled once an admin exists unless re-enabled. Sessions in PG, secure cookies, CSRF.
- Deploy: docker-compose (postgres, server, web), env config, reverse-proxy friendly (wss://host/<token> behind TLS proxy); tcp listener too; udp last.

## Milestones (commit small steps on `main`, no pushing; report at each gate)
- M0 protocol spike + conformance harness — MUST come first. With a real unmodified easytier-core (official release matching the pin, or built from the checkout with cargo for the TEST client only, in scratch): (a) accept wss/ws and tcp config-server connections, (b) handshake incl. optional secure mode (find when clients use it: `secure_mode` in JNI/FFI & CLI), (c) answer Heartbeat/GetFeature, (d) RunNetworkInstance with minimal NetworkConfig and see it run, (e) CollectNetworkInfo / ListNetworkInstance / GetNetworkInstanceConfig decoded, (f) survive reconnects + heartbeats. Automated conformance test in repo (docker-compose test profile with real easytier-core container, vitest/bun test). If something cannot be matched on Node (likely Noise secure-mode), STOP and report exactly what fails + options (separate Go/Rust tunnel front forwarding decoded RPC to Node; non-secure only) with trade-offs.
- M1 server core: DB schema/migrations, SSO login + roles, devices/invites/approval, desired-state storage + push, heartbeat/status/last-seen, audit log; minimal UI (login, networks, devices, pending approvals, invite w/ QR + command).
- M2 policy: tags/ACL editor + compiler + preview, MagicDNS, subnet approval workflow.
- M3 realtime: live status SSE/WS, topology map, device drawer.
- M4 hardening: tests, rate limits, docs, compose, import flows (TOML / share link / adopt from device).

## Non-functional
Security (roles enforced server-side per endpoint, secrets encrypted at rest, invite tokens hashed, never log secrets/configs, audit log, constant-time compare, zod validation, rate limits on listener+API); reliability (idempotent push with revisions, per-device state machine pending/approved/blocked × online/offline × in-sync/stale/error, load test with a few hundred simulated clients); i18n en+ru; observability (structured logs, /health, optional Prometheus); docs: README, docs/PROTOCOL.md, docs/COMPATIBILITY.md, docs/DEPLOY.md.

## Testing
Unit: framing/codec, policy compiler (golden), config normalization (TOML/share-link ↔ NetworkConfig), approval state machine, OIDC claim mapping. E2E (docker-compose, real easytier-core 2–3 containers, pinned version): join via invite, approve, config received, network forms, desired-vs-applied revision, online/offline, policy enforcement, MagicDNS, approved vs unapproved subnet route, map data. Frontend: typecheck, lint, tests where the reference has a harness. GitHub Actions CI.
