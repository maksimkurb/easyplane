import type { Pool } from "pg";

import type { AppEnv } from "../env.js";
import type { Database } from "../db/client.js";
import { ensureOrganisation, listApprovedDevicesByRole } from "../db/repositories.js";
import type { Organisation } from "../db/schema.js";
import { hubPublicIpsChanged } from "../domain/hub.js";
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
import { CredentialService } from "../services/credential-service.js";
import { DeviceService } from "../services/device-service.js";
import { DeviceSessionRegistry } from "../services/device-sessions.js";
import { InviteService } from "../services/invite-service.js";
import { NetworkService } from "../services/network-service.js";
import { PolicyService } from "../services/policy-service.js";
import { PushService, pushNetworkDevices } from "../services/push-service.js";
import { RouteService } from "../services/route-service.js";
import { TopologyService } from "../topology/collector.js";
import { WireguardService } from "../services/wireguard-service.js";

// Release images set EASYPLANE_VERSION from the image tag (see
// .github/workflows/_image.yml); a local run keeps the built-in default.
export const VERSION = process.env.EASYPLANE_VERSION?.trim() || "0.3.0-M3";

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
  credentials: CredentialService;
  deviceSessions: DeviceSessionRegistry;
  push: PushService;
  devices: DeviceService;
  policies: PolicyService;
  routes: RouteService;
  wireguard: WireguardService;
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
  const invites = new InviteService(db, audit);
  const deviceSessions = new DeviceSessionRegistry();
  let pushService: PushService | undefined;
  const credentialService = new CredentialService({
    db,
    secretBox,
    audit,
    logger,
    realtime,
    ttlMs: env.credentialTtlMs,
    renewBeforeMs: env.credentialRenewBeforeMs,
    onCredentialsChanged: async (networkId, reason, memberDeviceId) => {
      // Anchors carry the managed credential list; a renewed/reissued
      // credential also changes that one member's own config.
      const anchors = await listApprovedDevicesByRole(db, networkId, "anchor");
      for (const anchor of anchors) pushService?.schedule(anchor.id, reason);
      if (memberDeviceId) pushService?.schedule(memberDeviceId, reason);
    },
  });
  const networks = new NetworkService(
    db,
    secretBox,
    audit,
    env.rendezvous,
    realtime,
    credentialService,
    (deviceId) => deviceSessions.get(deviceId) !== undefined,
    logger,
  );
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
    rendezvousEndpoints: env.rendezvous.endpoints,
    credentials: {
      publishableMaterial: (networkId) =>
        credentialService.publishableMaterial(networkId),
      memberMaterial: (deviceId) => credentialService.memberMaterial(deviceId),
    },
    onDeviceUpdated: async (deviceId, reason) => {
      await devicesService?.notifyDevice(deviceId, reason);
    },
    compileAcl: async (network, deviceId, policyVersion) => {
      if (!policies) return undefined;
      return policies.compileForVersion(network, deviceId, policyVersion);
    },
    declareRoutes: async (device, declared) => {
      if (!routes) return;
      await routes.declare(device, declared);
    },
    recordReport: async (device, payload) => {
      if (!routes) return;
      await routes.recordReport(device, payload);
    },
  });
  pushService = push;
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
    heartbeatPersistIntervalMs: env.heartbeatPersistIntervalMs,
    listClients: () => controlPlane?.listClients() ?? [],
    credentials: credentialService,
  });
  devicesService = devices;

  const wireguard = new WireguardService({
    db,
    secretBox,
    audit,
    push,
    sessions: deviceSessions,
    logger,
    realtime,
  });

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
    probeWireguardPortal: async (device, client) => {
      await wireguard.collectStatuses(device, client);
    },
    onPublicIpsChanged: async ({ device, previousPublicIps, publicIps }) => {
      // Only a hub's public address changes what peers dial. Other devices'
      // stored public IPs are informational.
      if (
        !hubPublicIpsChanged(device, previousPublicIps, publicIps)
      ) {
        return;
      }
      await pushNetworkDevices(
        db,
        push,
        device.networkId,
        "hub public address changed",
      );
      // The address is device state, not a network setting, but this event is
      // the existing "refetch devices in this network" signal and changes here
      // are rare (only when the detected public address really moved).
      realtime.publish({
        type: "network.updated",
        orgId: device.orgId,
        networkId: device.networkId,
        data: {
          networkId: device.networkId,
          reason: "hub-public-address-updated",
        },
      });
    },
  });

  controlPlane = new ControlPlaneServer({
    host: env.host,
    tcpPort: env.tcpPort,
    wsPort: env.wsPort,
    wss: env.wss,
    udpPort: env.udpPort,
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
    credentials: credentialService,
    deviceSessions,
    push,
    devices,
    policies: policyService,
    routes: routeService,
    wireguard,
    controlPlane,
    realtime,
    topology,
    metrics,
  };
}
