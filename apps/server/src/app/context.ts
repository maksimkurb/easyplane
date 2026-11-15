import type { Pool } from "pg";

import type { AppEnv } from "../env.js";
import type { Database } from "../db/client.js";
import { ensureOrganisation } from "../db/repositories.js";
import type { Organisation } from "../db/schema.js";
import { AuthService } from "../auth/service.js";
import { OidcClient } from "../auth/oidc.js";
import { SessionService } from "../auth/session.js";
import { ControlPlaneServer } from "../control/control-plane.js";
import { createLogger, type Logger } from "../logger.js";
import { ImportService } from "../import/service.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { RealtimeHub } from "../realtime/hub.js";
import { SecretBox } from "../security/crypto.js";
import { AuditService } from "../services/audit.js";
import { DeviceService } from "../services/device-service.js";
import { DeviceSessionRegistry } from "../services/device-sessions.js";
import { InviteService } from "../services/invite-service.js";
import { NetworkService } from "../services/network-service.js";
import { PolicyService } from "../services/policy-service.js";
import { PushService } from "../services/push-service.js";
import { RouteService } from "../services/route-service.js";
import { TopologyService } from "../topology/collector.js";

export const VERSION = "0.3.0-M3";

function normalizeIp(value: string): string {
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length);
  return value;
}

export interface AppContext {
  env: AppEnv;
  db: Database;
  pool: Pool;
  logger: Logger;
  organisation: Organisation;
  secretBox: SecretBox;
  oidc: OidcClient;
  sessions: SessionService;
  audit: AuditService;
  auth: AuthService;
  networks: NetworkService;
  imports: ImportService;
  invites: InviteService;
  deviceSessions: DeviceSessionRegistry;
  push: PushService;
  devices: DeviceService;
  policies: PolicyService;
  routes: RouteService;
  controlPlane: ControlPlaneServer;
  realtime: RealtimeHub;
  topology: TopologyService;
  metrics: MetricsRegistry;
}

export interface CreateContextOptions {
  env: AppEnv;
  db: Database;
  pool: Pool;
  /**
   * Resolved organisation. When omitted it is created/fetched from the DB; the
   * OpenAPI generator passes a placeholder because it never queries.
   */
  organisation?: Organisation;
  logger?: Logger;
}

export async function createAppContext(
  options: CreateContextOptions,
): Promise<AppContext> {
  const { env, db, pool } = options;
  const logger = options.logger ?? createLogger({ level: env.logLevel as "info" });
  const metrics = new MetricsRegistry();
  const organisation =
    options.organisation ??
    (await ensureOrganisation(db, { slug: env.orgSlug, name: env.orgName }));

  const secretBox = new SecretBox(
    env.encryptionKey !== ""
      ? env.encryptionKey
      : // Non-production fallback only: lets `bun run dev` start without a key.
        Buffer.alloc(32, 7),
  );
  const audit = new AuditService(db);
  const oidc = new OidcClient(env.oidcProviders);
  const sessions = new SessionService(db, {
    idleMs: env.sessionIdleMs,
    absoluteMs: env.sessionAbsoluteMs,
    secureCookies: env.secureCookies,
  });
  const auth = new AuthService({
    db,
    orgId: organisation.id,
    oidc,
    sessions,
    audit,
    bootstrapToken: env.bootstrapAdminToken,
    bootstrapReenable: env.bootstrapReenable,
  });
  const realtime = new RealtimeHub({
    maxPerUser: env.sseMaxPerUser,
    maxTotal: env.sseMaxTotal,
    bufferSize: env.sseEventBuffer,
  });
  const networks = new NetworkService(db, secretBox, audit, realtime);
  const invites = new InviteService(db, audit);
  const deviceSessions = new DeviceSessionRegistry();
  const imports = new ImportService({
    db,
    networks,
    sessions: deviceSessions,
    logger,
    metrics,
  });
  // PolicyService and RouteService are wired after the push service because
  // they need to schedule pushes; the push service only needs callbacks.
  let policies: PolicyService | undefined;
  let routes: RouteService | undefined;
  let devicesService: DeviceService | undefined;
  const push = new PushService({
    db,
    secretBox,
    sessions: deviceSessions,
    audit,
    logger,
    reportIntervalMs: env.routeReportIntervalMs,
    metrics,
    onDeviceUpdated: async (deviceId, reason) => {
      await devicesService?.notifyDevice(deviceId, reason);
    },
    compileAcl: async (network, deviceId, policyVersion) => {
      if (!policies) return undefined;
      return policies.compileForVersion(network, deviceId, policyVersion);
    },
    recordReport: async (device, payload) => {
      if (!routes) return;
      await routes.recordReport(device, payload);
    },
  });
  policies = new PolicyService({ db, secretBox, audit, push, realtime });
  routes = new RouteService({ db, audit, push, realtime });
  const policyService = policies;
  const routeService = routes;

  let controlPlane: ControlPlaneServer | undefined;
  const devices = new DeviceService({
    db,
    audit,
    invites,
    push,
    sessions: deviceSessions,
    realtime,
    logger,
    onlineTimeoutMs: env.deviceOnlineTimeoutMs,
    maxPendingPerNetwork: env.maxPendingDevicesPerNetwork,
    unknownTokenLimitPerMinute: env.unknownTokenLimitPerMinute,
    listClients: () => controlPlane?.listClients() ?? [],
  });
  devicesService = devices;

  const topology = new TopologyService({
    db,
    sessions: deviceSessions,
    realtime,
    logger,
    idleIntervalMs: env.topologyIdleIntervalMs,
    activeIntervalMs: env.topologyActiveIntervalMs,
    jitterRatio: env.topologyJitterRatio,
    concurrency: env.topologyConcurrency,
    deviceTimeoutMs: env.topologyTimeoutMs,
    maxDevicesPerCycle: env.topologyMaxDevices,
    metrics,
  });

  controlPlane = new ControlPlaneServer({
    host: env.host,
    tcpPort: env.tcpPort,
    wsPort: env.wsPort,
    wss: env.wss,
    supportEncryption: env.supportEncryption,
    logger,
    maxConnections: env.maxClientConnections,
    acceptLimitPerMinute: env.clientAcceptLimitPerMinute,
    heartbeatTimeoutMs: env.clientHeartbeatTimeoutMs,
    metrics,
    onHeartbeat: async (client, request, snapshot) => {
      await devices.handleHeartbeat({
        token: request.userToken,
        machineId: snapshot.machineId,
        hostname: snapshot.hostname,
        easytierVersion: snapshot.easytierVersion,
        osType: snapshot.deviceOs.osType,
        osVersion: snapshot.deviceOs.version,
        osDistribution: snapshot.deviceOs.distribution,
        sourceIp: normalizeIp(client.remoteAddress),
        client,
      });
    },
    onClientClosed: (client) => devices.handleSessionClosed(client),
  });

  // The organisation is attached to audit rows by the services themselves, but
  // keeping it on the context avoids re-reading it in every route.
  return {
    env,
    db,
    pool,
    logger,
    organisation,
    secretBox,
    oidc,
    sessions,
    audit,
    auth,
    networks,
    imports,
    invites,
    deviceSessions,
    push,
    devices,
    policies: policyService,
    routes: routeService,
    controlPlane,
    realtime,
    topology,
    metrics,
  };
}
