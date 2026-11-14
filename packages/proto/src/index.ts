/**
 * TypeScript bindings for the upstream EasyTier protobuf definitions.
 *
 * `src/generated/` is produced by `scripts/generate-protos.sh` from
 * `proto/easytier/*.proto`, which `scripts/sync-protos.sh` copies verbatim from
 * the pinned upstream commit (see `proto/easytier/UPSTREAM_REF`).
 *
 * Modules are re-exported as namespaces because several upstream protos share
 * top-level message names (e.g. `common.Error` vs the `error` package).
 */
export * as common from "./generated/common.js";
export * as error from "./generated/error.js";
export * as web from "./generated/web.js";
export * as manage from "./generated/api_manage.js";
export * as instance from "./generated/api_instance.js";
export * as peerRpc from "./generated/peer_rpc.js";
export * as acl from "./generated/acl.js";
export * as coreConfig from "./generated/core_config.js";
export * as corePeer from "./generated/core_peer.js";
export * as magicDns from "./generated/magic_dns.js";
export * as configApi from "./generated/api_config.js";
export * as loggerApi from "./generated/api_logger.js";
export * as tests from "./generated/tests.js";
