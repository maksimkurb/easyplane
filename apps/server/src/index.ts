export {
  ControlPlaneServer,
  type ControlPlaneOptions,
  type ControlPlaneAddresses,
} from "./control/control-plane.js";
export { ManagedClient, type HeartbeatSnapshot } from "./control/managed-client.js";
export { RemoteWebClient } from "./control/remote-client.js";
export { buildMinimalNetworkConfig, type MinimalNetworkConfigOptions } from "./config/network-config.js";
export { createLogger, createSilentLogger, type Logger } from "./logger.js";
export { RpcSession } from "./rpc/session.js";
export {
  RpcRemoteError,
  decompressBody,
  decompressZstd,
  decompressZstdFallback,
  makeRemoteError,
  remoteErrorToMessage,
} from "./rpc/codec.js";
export {
  WEB_CLIENT_SERVICE,
  WEB_SERVER_SERVICE,
  WebClientMethod,
  WebServerMethod,
} from "./rpc/descriptors.js";
export { buildTunnelPayload, decodePeerManagerHeader, type PeerManagerHeader } from "./protocol/peer-header.js";
export {
  NOISE_MAGIC,
  NOISE_PROLOGUE,
  PEER_MANAGER_HEADER_SIZE,
  PacketType,
} from "./protocol/constants.js";
export {
  deriveTrafficKey,
  openAeadPayload,
  sealAeadPayload,
  SecureDatagramSession,
  SecureDirection,
} from "./protocol/secure-datagram.js";
export { noiseRespond } from "./protocol/noise.js";
export { acceptLink, type AcceptedLink, type TunnelLink } from "./transport/link.js";
export {
  FrameQueue,
  tcpFrameTransport,
  websocketFrameTransport,
  type FrameTransport,
  type TransportKind,
} from "./transport/frames.js";

// M1
export { readEnv, type AppEnv, type OidcProviderConfig } from "./env.js";
export { createDatabase, type Database, type DatabaseHandle } from "./db/client.js";
export { runMigrations } from "./db/migrate.js";
export * as schema from "./db/schema.js";
export { createAppContext, VERSION, type AppContext } from "./app/context.js";
export { buildApp, type BuildAppOptions } from "./app/build-app.js";
export {
  mapIdentity,
  getGroups,
  type MappedIdentity,
} from "./auth/claims.js";
export { OidcClient, createPkcePair, codeChallenge } from "./auth/oidc.js";
export { SessionService, SESSION_COOKIE, CSRF_COOKIE } from "./auth/session.js";
export { AuthService, AuthError, type CompletedLogin } from "./auth/service.js";
export {
  evaluateInvite,
  type InviteEvaluation,
  type InviteRejection,
} from "./domain/invite.js";
export {
  computeDeviceStatus,
  type DeviceStatus,
  type ApprovalState,
  type OnlineState,
  type SyncState,
} from "./domain/device-status.js";
export {
  desiredConfigSchema,
  normalizeDesiredConfig,
  buildNetworkConfig,
  configMatchesDesired,
  type DesiredConfig,
} from "./domain/desired-config.js";
export {
  nextRevisionNumber,
  latestRevision,
  planRollback,
  type RevisionRecord,
  type RollbackPlan,
} from "./domain/revisions.js";
export { allocateIpv4, parseCidr, parseIpv4, formatIpv4 } from "./domain/ip.js";
export {
  SecretBox,
  constantTimeEqual,
  deterministicUuid,
  generateNetworkSecret,
  parseEncryptionKey,
  randomToken,
  sha256Hex,
  slugify,
} from "./security/crypto.js";
export { AuditService, sanitizeAuditMetadata } from "./services/audit.js";
export {
  UnknownTokenRateLimiter,
  DeviceService,
  type DeviceDto,
  type RevisionDto,
} from "./services/device-service.js";
export { DeviceSessionRegistry } from "./services/device-sessions.js";
export { InviteService, type InviteDto } from "./services/invite-service.js";
export { NetworkService, type NetworkDto } from "./services/network-service.js";
export {
  instanceIdFor,
  PushService,
  pushNetworkDevices,
  type PushResult,
} from "./services/push-service.js";

// M2
export * from "./domain/policy/index.js";
export { canonicalAcl } from "./domain/policy/canonical.js";
export {
  DEFAULT_MAGIC_DNS_ZONE,
  allocateDnsLabel,
  isValidDnsLabel,
  magicDnsName,
  normalizeDnsZone,
  toDnsLabel,
  type ResolvedName,
} from "./domain/magic-dns.js";
export {
  acceptedRoutesFor,
  approvedExitNode,
  approvedSubnetCidrs,
  buildRouteReport,
  cidrContains,
  cidrsOverlap,
  ipv4ToHostCidr,
  normalizeCidr,
  validateSubnetRequest,
  type ReportedInstance,
  type RouteKind,
  type RouteRecord,
  type RouteReport,
  type RouteState,
} from "./domain/routes.js";
export {
  PolicyService,
  type CompiledAclSummary,
  type PolicyVersionDto,
  type PreviewResult,
} from "./services/policy-service.js";
export {
  RouteService,
  type DeviceRouteDto,
  type RouteReportDto,
} from "./services/route-service.js";
export { AppError } from "./services/errors.js";
