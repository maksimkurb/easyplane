import { acl, manage } from "@easyplane/proto";
import { protoToUuid } from "@easyplane/shared";

import type { ManagedClient } from "../control/managed-client.js";
import type { DbExecutor } from "../db/repositories.js";
import {
  approvedRoutesForNetwork,
  getDeviceById,
  getNetworkById,
  listDeviceRoutes,
  listNetworkPeerRecords,
  listRevisions,
  listWireguardClientsForHub,
  updateDevice,
} from "../db/repositories.js";
import type { Device, Network } from "../db/schema.js";
import {
  buildNetworkConfig,
  configMatchesDesired,
  describeConfigMismatch,
  isConfigReadOnly,
  normalizeDesiredConfig,
  CONFIG_PERMISSION_READ_ONLY,
} from "../domain/desired-config.js";
import {
  desiredFingerprint,
  nextDriftState,
  readDriftState,
  shouldBackOff,
  shortFingerprint,
  withoutDriftState,
} from "../domain/drift.js";
import {
  buildVpnPortalConfig,
  isPortalApplyError,
  portalModeForDevice,
  readPortalApplyError,
  readPortalSnapshot,
  withoutPortalApplyError,
  withPortalApplyError,
  type WireguardPortalMode,
} from "../domain/wireguard.js";
import {
  buildManagedCredentials,
  effectiveRole,
  type CredentialMaterial,
} from "../domain/credentials.js";
import { cidrPrefix, formatIpv4, parseIpv4 } from "../domain/ip.js";
import { effectiveHubEndpoints, effectiveListenerUrls } from "../domain/hub.js";
import { compilePeerUrls } from "../domain/peers.js";
import { tagGroupName } from "../domain/policy/resolve.js";
import {
  acceptedRoutesFor,
  approvedExitNode,
  approvedSubnetCidrs,
  declaredExitNode,
  declaredSubnetCidrs,
  type ReportedInstance,
} from "../domain/routes.js";
import { deterministicUuid } from "../security/crypto.js";
import type { SecretBox } from "../security/crypto.js";
import type { Logger } from "../logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { METRIC_NAMES } from "../observability/metrics.js";
import type { AuditService } from "./audit.js";
import type { DeviceSessionRegistry } from "./device-sessions.js";

export interface PushResult {
  status: "pushed" | "already-in-sync" | "skipped" | "error";
  reason?: string;
  revision?: number;
}

export interface PushServiceOptions {
  db: DbExecutor;
  secretBox: SecretBox;
  sessions: DeviceSessionRegistry;
  audit: AuditService;
  logger: Logger;
  /** Poll interval while waiting for the instance to report running. */
  pollIntervalMs?: number;
  /** Number of polls before a push is considered failed. */
  pollAttempts?: number;
  /**
   * Compiler hook: returns the ACL for a device at a policy version. Wired to
   * PolicyService in the app context (kept as a function to avoid a service
   * dependency cycle).
   */
  compileAcl?: (
    network: Network,
    deviceId: string,
    policyVersion: number,
  ) => Promise<acl.Acl | undefined>;
  /**
   * Turns the managed instance's own declared proxy CIDRs / exit-node flag into
   * pending proposals. Called *before* the drift comparison so the desired
   * config can adopt the declaration instead of erasing it.
   */
  declareRoutes?: (
    device: Device,
    declared: { subnetCidrs: string[]; exitNode: boolean },
  ) => Promise<void>;
  /** Persists what the client reports about its routes. */
  recordReport?: (
    device: Device,
    payload: {
      instances: ReportedInstance[];
      peerObservations: Array<{ ipv4: string; hostname: string; proxyCidrs: string[] }>;
      /**
       * What the managed instance's own config says it advertises. `undefined`
       * when the config could not be read (read-only file, instance starting).
       */
      declared?: { subnetCidrs: string[]; exitNode: boolean };
      /** `ListNetworkInstanceMeta.config_permission` of the managed instance. */
      configPermission?: number;
    },
  ) => Promise<void>;
  /** Minimum gap between route reports per device. */
  reportIntervalMs?: number;
  /** Called after a push changes applied revision or the last error. */
  onDeviceUpdated?: (deviceId: string, reason: string) => Promise<void>;
  metrics?: MetricsRegistry;
  /**
   * Peer URLs of the bundled rendezvous node. Appended to the compiled peer
   * list of a network that opted in (`networks.use_rendezvous`).
   */
  rendezvousEndpoints?: readonly string[];
  /**
   * Credential-mode hooks (docs/CREDENTIALS.md). Wired to CredentialService.
   * An anchor receives every active member credential in
   * `managed_credentials`; a member receives only its own X25519 key and no
   * network secret.
   */
  credentials?: {
    publishableMaterial: (networkId: string) => Promise<CredentialMaterial[]>;
    memberMaterial: (deviceId: string) => Promise<CredentialMaterial | null>;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function toIpv4Number(value: string | null): number {
  if (!value) return -1;
  try {
    return parseIpv4(value);
  } catch {
    return -1;
  }
}

export function instanceIdFor(networkId: string, deviceId: string): string {
  return deterministicUuid("easyplane.network-instance", networkId, deviceId);
}

/** Schedules a push for every approved device of a network. */
export async function pushNetworkDevices(
  db: DbExecutor,
  push: PushService,
  networkId: string,
  reason: string,
): Promise<number> {
  const rows = await db.query.devices.findMany({
    where: (table, { and, eq }) =>
      and(eq(table.networkId, networkId), eq(table.state, "approved")),
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
  });
  for (const device of rows) push.schedule(device.id, reason);
  return rows.length;
}

/**
 * Desired-state engine: builds the per-device NetworkConfig from the latest
 * revision, pushes it idempotently, verifies the instance is running and records
 * applied revision / error. Pushes happen on connect (heartbeat) and whenever a
 * revision, approval or address changes.
 */
export class PushService {
  private readonly inFlight = new Map<string, Promise<PushResult>>();
  private readonly queued = new Set<string>();
  private readonly lastReportAt = new Map<string, number>();
  /** Last config-server session seen per device; a change means a reconnect. */
  private readonly lastSessionByDevice = new Map<string, string>();
  /** Throttles the drift log: one info line per fingerprint + attempt. */
  private readonly lastLoggedDrift = new Map<string, string>();
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(private readonly options: PushServiceOptions) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.reconcile().catch((error: unknown) => {
        this.options.logger.warn("reconcile failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled([...this.inFlight.values()]);
  }

  /** Fire-and-forget push; concurrent requests for one device are coalesced. */
  schedule(deviceId: string, reason: string): void {
    if (this.inFlight.has(deviceId)) {
      // A change landed while a push was running; run once more afterwards so
      // the newest revision wins instead of being lost.
      this.queued.add(deviceId);
      return;
    }
    void this.runExclusive(deviceId, () => this.ensureInner(deviceId)).catch(
      (error: unknown) => {
        this.options.logger.warn("scheduled push failed", {
          deviceId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        return { status: "error" as const, reason: "push failed" };
      },
    );
  }

  /** Waits for any in-flight push and returns the (possibly coalesced) result. */
  pushNow(deviceId: string): Promise<PushResult> {
    return this.runExclusive(deviceId, () => this.doPush(deviceId));
  }

  /**
   * Operator "retry now": clears the drift backoff (so the next attempt is
   * immediate instead of waiting up to 15 minutes) and converges. Used by the
   * manual push endpoint and the inline notice in the UI.
   */
  async retry(deviceId: string): Promise<PushResult> {
    await this.clearDrift(deviceId, "manual retry");
    await this.clearPortalRejection(deviceId);
    return this.ensure(deviceId);
  }

  /**
   * One push per device at a time. A caller that arrives during a push joins it
   * and marks a follow-up run, so the newest revision is never dropped.
   */
  private runExclusive(
    deviceId: string,
    task: () => Promise<PushResult>,
  ): Promise<PushResult> {
    const existing = this.inFlight.get(deviceId);
    if (existing) {
      this.queued.add(deviceId);
      return existing;
    }
    const promise = task().finally(() => {
      this.inFlight.delete(deviceId);
      if (this.queued.delete(deviceId)) this.schedule(deviceId, "queued");
    });
    this.inFlight.set(deviceId, promise);
    return promise;
  }

  /**
   * Push only when the device is not already verifiably running the desired
   * revision. Used on every (re)connect, so a client that lost its instance
   * (restart, crash) converges again without operator action.
   */
  async ensure(deviceId: string): Promise<PushResult> {
    return this.runExclusive(deviceId, () => this.ensureInner(deviceId));
  }

  private async ensureInner(deviceId: string): Promise<PushResult> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device) return { status: "skipped", reason: "device not found" };
    if (device.state !== "approved") {
      return { status: "skipped", reason: `device is ${device.state}` };
    }
    const client = this.options.sessions.get(deviceId);
    if (!client) return { status: "skipped", reason: "offline" };

    // A reconnect resets the drift schedule: the client may have been
    // upgraded, restarted with a new config or fixed by the operator. Without
    // this, a device that reconnects right after a drift stays silent for up
    // to 15 minutes.
    const previousSession = this.lastSessionByDevice.get(deviceId);
    if (previousSession !== client.id) {
      this.lastSessionByDevice.set(deviceId, client.id);
      if (previousSession !== undefined) {
        await this.clearDrift(deviceId, "device reconnected");
        device.reportedState = withoutDriftState(device.reportedState);
      }
    }

    if (
      isConfigReadOnly(device.reportedState) &&
      (await this.refreshConfigPermission(
        device,
        client,
        instanceIdFor(device.networkId, device.id),
      ))
    ) {
      // Still refresh the report (instances, peers, permission) so the panel
      // shows the locally managed state instead of an empty/old one.
      await this.collectReport(device, client);
      return { status: "skipped", reason: "config is locally managed (read-only)" };
    }

    const revisions = await listRevisions(this.options.db, deviceId);
    const latest = revisions[0];
    if (!latest) return { status: "skipped", reason: "no desired config" };

    // One convergence after the explicit manual-route list was introduced.
    // The pinned client cannot echo "manual routes, empty list", so an
    // already-in-sync device would otherwise keep installing every advertised
    // proxy CIDR forever (docs/DEPLOY.md §4b).
    if (!device.manualRoutesEnforcedAt) {
      return this.doPush(deviceId);
    }

    if (
      device.appliedRevision !== null &&
      device.appliedRevision >= latest.revision
    ) {
      try {
        const instanceId = instanceIdFor(device.networkId, device.id);
        const listed = await client.remote.listNetworkInstance();
        if (listed.includes(instanceId)) {
          const reported = await client.remote.getNetworkInstanceConfig(instanceId);
          const network = await getNetworkById(this.options.db, device.networkId);
          if (network) {
            // Detect a locally declared route before comparing: the desired
            // config then carries it (pending declarations are adopted), so the
            // comparison matches and no push erases the operator's edit.
            try {
              await this.options.declareRoutes?.(device, {
                subnetCidrs: reported.config?.proxyCidrs ?? [],
                exitNode: Boolean(reported.config?.enableExitNode),
              });
            } catch (error) {
              this.options.logger.debug("declaration detection failed", {
                deviceId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            const desired = await this.desiredConfigFor(
              device,
              network,
              latest.config,
              latest.policyVersion,
            );
            if (configMatchesDesired(reported.config, desired.config)) {
              if (readDriftState(device.reportedState)) {
                await this.clearDrift(deviceId, "config matches desired");
                device.reportedState = withoutDriftState(device.reportedState);
              }
              // A device that echoes our per-client portal back is a newer
              // build even if its version string is missing/garbled; remember
              // that so the UI and the client endpoints stop treating it as
              // legacy.
              if (
                desired.config.vpnPortalConfig !== undefined &&
                reported.config?.vpnPortalConfig !== undefined &&
                portalModeForDevice(device) !== "per-client"
              ) {
                await this.persistPortalMode(device, "per-client");
              }
              await this.collectReport(device, client);
              this.options.metrics?.inc(METRIC_NAMES.pushes, { status: "in-sync" });
              return {
                status: "already-in-sync",
                revision: latest.revision,
              };
            }
            const driftReasons = describeConfigMismatch(
              reported.config,
              desired.config,
            );
            const fingerprint = desiredFingerprint(desired.config);
            const drift = readDriftState(device.reportedState);
            const now = new Date();
            if (shouldBackOff(drift, fingerprint, now)) {
              this.logDrift(deviceId, drift!, fingerprint, "backoff");
              this.options.metrics?.inc(METRIC_NAMES.pushes, { status: "backoff" });
              return {
                status: "skipped",
                reason: `config drift; next retry at ${drift!.nextRetryAt}`,
                revision: latest.revision,
              };
            }
            return this.doPush(deviceId, {
              drift: {
                fingerprint,
                reason: driftReasons.join("; ").slice(0, 1000),
              },
            });
          }
        }
      } catch (error) {
        this.options.logger.debug("config verification failed; repushing", {
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.doPush(deviceId);
  }

  private async desiredConfigFor(
    device: Device,
    network: Network,
    rawConfig: Record<string, unknown>,
    policyVersion: number | null,
  ): Promise<{ config: manage.NetworkConfig; portalFingerprint: string | null }> {    const [approvedRoutes, deviceRoutes, compiledAcl, peerRecords] = await Promise.all([
      approvedRoutesForNetwork(this.options.db, network.id),
      listDeviceRoutes(this.options.db, device.id),
      this.aclFor(network, device, policyVersion),
      listNetworkPeerRecords(this.options.db, network.id),
    ]);
    const role = effectiveRole(network.accessMode, device.role);
    const credentialMode = network.accessMode === "credentials";
    let managedCredentials: manage.ManagedCredentialConfig[] | undefined;
    let memberCredentialSecret: string | undefined;
    if (credentialMode && this.options.credentials) {
      if (role === "anchor") {
        managedCredentials = buildManagedCredentials(
          await this.options.credentials.publishableMaterial(network.id),
        );
      } else {
        const material = await this.options.credentials.memberMaterial(device.id);
        if (!material) {
          throw new Error(
            "device credential is revoked or expired; it cannot join until a new credential is issued",
          );
        }
        memberCredentialSecret = material.secret;
      }
    }
    // Peer URLs are network state compiled per device: the target's own hub
    // entry is excluded by device id (and machine id), so a hub is a listener
    // and never dials its own advertised endpoint.
    const peerUrls = compilePeerUrls({
      targetDeviceId: device.id,
      targetMachineId: device.machineId,
      entries: peerRecords.map(({ peer, device: peerDevice }) => ({
        deviceId: peer.deviceId,
        url: peer.url,
        device: peerDevice
          ? {
              id: peerDevice.id,
              machineId: peerDevice.machineId,
              state: peerDevice.state,
              isHub: peerDevice.isHub,
              advertisedEndpoints: effectiveHubEndpoints(peerDevice),
            }
          : null,
      })),
      // The rendezvous node is not a device of this network, so it is never
      // excluded for the target and only contributes when the network opted in.
      rendezvousEndpoints: network.useRendezvous
        ? (this.options.rendezvousEndpoints ?? [])
        : [],
    });
    // WireGuard portal settings are only expressible from EasyTier 2.7.0 on.
    // 2.6.x has no `vpn_portal_config` field in NetworkConfig at all, so
    // pushing one produces permanent "drift" and an endless repush (prod h-1,
    // 2.6.4-8428a89d). Its portal is configured on the device
    // (`--vpn-portal wg://host:port/<client CIDR>`) and only read back here.
    const portalMode: WireguardPortalMode = device.isHub
      ? portalModeForDevice(device)
      : "legacy";
    if (device.isHub && device.wgListenPort !== null && portalMode !== "per-client") {
      this.logLegacyPortalOnce(device, portalMode);
    }
    // A probe that proved the build has no WireGuard support (`vpn_type =
    // "null"`) means pushing the field can never converge: stop sending it
    // instead of drifting forever. The probe re-adds it as soon as the device
    // reports a working portal (e.g. after an upgrade).
    const portalUnsupported =
      readPortalSnapshot(device.reportedState)?.state === "unsupported";
    // EasyTier >= 2.7.0 validates each client's `virtual_ip` as an Ipv4Inet:
    // a bare address becomes a /32 whose first and last address are the client
    // itself, so the portal refuses to start ("has an unusable virtual IP").
    // The prefix must be the virtual network's prefix.
    const networkPrefixLength =
      normalizeDesiredConfig(rawConfig).networkLength ??
      cidrPrefix(network.ipv4Cidr);
    const vpnPortal =
      portalMode === "per-client" && !portalUnsupported
        ? await this.vpnPortalConfigFor(device, compiledAcl, networkPrefixLength)
        : undefined;
    const config = this.buildConfig(
      device,
      network,
      rawConfig,
      policyVersion,
      approvedRoutes,
      deviceRoutes,
      compiledAcl,
      peerUrls,
      { managedCredentials, memberCredentialSecret, role },
      vpnPortal,
    );
    if (!vpnPortal) return { config, portalFingerprint: null };
    const portalFingerprint = desiredFingerprint(config);
    // The device rejected this exact portal config before. Keep our rows and
    // the network running: push the same config without the portal field.
    const rejected = readPortalApplyError(device.reportedState);
    if (rejected?.fingerprint === portalFingerprint) {
      const { vpnPortalConfig: _omitted, ...rest } = config;
      return { config: rest as manage.NetworkConfig, portalFingerprint };
    }
    return { config, portalFingerprint };
  }

  /**
   * WireGuard portal settings for a hub. The master key is decrypted only here
   * (it goes into the pushed config, never into a revision or a log) and the
   * client groups are filtered to the ones the hub's compiled ACL declares —
   * upstream refuses to start the portal for an undeclared group.
   */
  private async vpnPortalConfigFor(
    device: Device,
    compiledAcl: acl.Acl | undefined,
    networkPrefixLength: number,
  ): Promise<manage.VpnPortalConfig | undefined> {
    if (!device.isHub || device.wgListenPort === null) return undefined;
    if (!device.wgPrivateKeyCiphertext) return undefined;
    const clients = await listWireguardClientsForHub(this.options.db, device.id);
    const declared = new Set(
      (compiledAcl?.aclV1?.group?.declares ?? []).map((entry) => entry.groupName),
    );
    return buildVpnPortalConfig(
      {
        listenPort: device.wgListenPort,
        privateKey: this.options.secretBox.decrypt(device.wgPrivateKeyCiphertext),
        networkPrefixLength,
      },
      clients.map((client) => ({
        name: client.name,
        virtualIpv4: client.virtualIpv4,
        groups: client.tags
          .map(tagGroupName)
          .filter((group) => group.startsWith("tag:") && declared.has(group)),
      })),
    );
  }

  private buildConfig(
    device: Device,
    network: Network,
    rawConfig: Record<string, unknown>,
    policyVersion: number | null,
    approvedRoutes: Awaited<ReturnType<typeof approvedRoutesForNetwork>>,
    deviceRoutes: Awaited<ReturnType<typeof listDeviceRoutes>>,
    compiledAcl: acl.Acl | undefined,
    peerUrls: string[],
    credentials: {
      managedCredentials?: manage.ManagedCredentialConfig[];
      memberCredentialSecret?: string;
      role: "anchor" | "member";
    },
    vpnPortalConfig?: manage.VpnPortalConfig,
  ): manage.NetworkConfig {
    const stored = normalizeDesiredConfig(rawConfig);
    const credentialMode = network.accessMode === "credentials";
    return buildNetworkConfig({
      networkId: network.id,
      deviceId: device.id,
      instanceId: instanceIdFor(network.id, device.id),
      hostname: device.dnsName ?? (device.hostname || "easyplane-device"),
      networkName: network.networkName,
      vpnPortalConfig,
      // A credential member must not receive the secret: `gen_config` only
      // takes the credential path when `network_secret` is absent.
      networkSecret:
        credentialMode && credentials.role === "member"
          ? undefined
          : this.options.secretBox.decrypt(network.secretCiphertext),
      managedCredentials: credentials.managedCredentials,
      memberCredentialSecret: credentials.memberCredentialSecret,
      stored,
      peerUrls,
      // A hub binds its listen port; non-hubs keep whatever the revision
      // stored. The effective list also makes an existing hub converge even
      // when it was enabled before this setting existed (port 11010 default).
      listenerUrls: effectiveListenerUrls(stored.listenerUrls, device),
      assignedIpv4: device.virtualIpv4,
      ipv4Cidr: network.ipv4Cidr,
      magicDnsEnabled: network.magicDnsEnabled,
      // A device's own config always carries its declared routes, pending or
      // approved, so a local edit is never erased by a push (the panel adopts
      // the declaration). Receivers only ever get approved routes.
      proxyCidrs: [
        ...new Set([
          ...approvedSubnetCidrs(approvedRoutes, device.id),
          ...declaredSubnetCidrs(deviceRoutes, device.id),
        ]),
      ].sort(),
      enableExitNode:
        approvedExitNode(approvedRoutes, device.id) ||
        declaredExitNode(deviceRoutes, device.id),
      manualRoutes: stored.acceptRoutes
        ? acceptedRoutesFor(approvedRoutes, device.id)
        : [],
      acl: compiledAcl,
      p2pOnly: network.p2pOnly,
      // Credential mode always needs secure mode: it carries the Noise key
      // that *is* the credential. The rendezvous node needs it for the
      // shared-secret proof.
      secureMode: network.useRendezvous || credentialMode,
    });
  }

  /**
   * ACL for the revision being pushed. Revisions created before M2 have no
   * policy version; they follow the network's active policy.
   */
  private async aclFor(
    network: Network,
    device: Device,
    policyVersion: number | null,
  ): Promise<acl.Acl | undefined> {
    if (!this.options.compileAcl) return undefined;
    const version = policyVersion ?? network.policyVersion;
    if (version <= 0) return undefined;
    try {
      return await this.options.compileAcl(network, device.id, version);
    } catch (error) {
      this.options.logger.warn("failed to compile the network policy", {
        deviceId: device.id,
        policyVersion: version,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async doPush(
    deviceId: string,
    options: { drift?: { fingerprint: string; reason: string } } = {},
  ): Promise<PushResult> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device) return { status: "skipped", reason: "device not found" };
    if (device.state !== "approved") {
      return { status: "skipped", reason: `device is ${device.state}` };
    }
    const instanceId = instanceIdFor(device.networkId, device.id);
    const offlineClient = this.options.sessions.get(deviceId);
    if (
      isConfigReadOnly(device.reportedState) &&
      (!offlineClient ||
        (await this.refreshConfigPermission(device, offlineClient, instanceId)))
    ) {
      // A read-only instance file is a state, not an error: the panel can
      // neither overwrite nor read it (SPIKE-DECLARED-ROUTES.md §4.2). Do not
      // retry and do not keep a stale error on the device. The state is
      // reported even when the device is offline.
      if (device.lastPushError) {
        await updateDevice(this.options.db, device.id, { lastPushError: null });
      }
      return { status: "skipped", reason: "config is locally managed (read-only)" };
    }
    const client = offlineClient;
    if (!client) return { status: "skipped", reason: "offline" };
    const network = await getNetworkById(this.options.db, device.networkId);
    if (!network) return { status: "skipped", reason: "network not found" };
    const revisions = await listRevisions(this.options.db, deviceId);
    const latest = revisions[0];
    if (!latest) return { status: "skipped", reason: "no desired config" };

    let desired: { config: manage.NetworkConfig; portalFingerprint: string | null };
    try {
      desired = await this.desiredConfigFor(
        device,
        network,
        latest.config,
        latest.policyVersion,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure(device, message);
      return { status: "error", reason: message, revision: latest.revision };
    }
    const config = desired.config;
    const fingerprint = desiredFingerprint(config);
    // A previous attempt for this exact config failed on the device (an apply
    // error, not a silent mismatch). Honour the backoff instead of hammering;
    // the manual retry clears it. A desired change produces a new fingerprint
    // and is attempted immediately.
    const drift = readDriftState(device.reportedState);
    if (!options.drift && shouldBackOff(drift, fingerprint, new Date())) {
      this.logDrift(deviceId, drift!, fingerprint, "backoff");
      this.options.metrics?.inc(METRIC_NAMES.pushes, { status: "backoff" });
      return {
        status: "skipped",
        reason: `config drift; next retry at ${drift!.nextRetryAt}`,
        revision: latest.revision,
      };
    }

    let applied = await this.applyConfig(client, instanceId, config);
    let portalFallback = false;
    if (
      !applied.ok &&
      config.vpnPortalConfig !== undefined &&
      isPortalApplyError(applied.error)
    ) {
      // The device rejected the portal part of the config and the whole
      // instance failed to start. Record its exact message, then push the same
      // config without the portal once so the network keeps running.
      await this.recordPortalRejection(device, applied.error, fingerprint);
      const { vpnPortalConfig: _omitted, ...rest } = config;
      applied = await this.applyConfig(
        client,
        instanceId,
        rest as manage.NetworkConfig,
      );
      portalFallback = true;
      if (applied.ok) {
        this.options.logger.warn(
          "hub rejected the WireGuard portal config; repushed without the portal",
          { deviceId, revision: latest.revision },
        );
      }
    }
    if (!applied.ok) {
      const message = applied.error;
      if (/is read-only/i.test(message)) {
        await this.markConfigReadOnly(device, message);
        return {
          status: "skipped",
          reason: "config is locally managed (read-only)",
          revision: latest.revision,
        };
      }
      await this.recordFailure(device, message, fingerprint);
      await this.options.audit.record({
        orgId: device.orgId,
        actorType: "system",
        action: "device.config.push_failed",
        targetType: "device",
        targetId: device.id,
        metadata: { revision: latest.revision, error: message.slice(0, 500) },
      });
      return {
        status: "error",
        reason: message,
        revision: latest.revision,
      };
    }

    const now = new Date();
    let reportedState = device.reportedState;
    if (options.drift) {
      // The client kept reporting a different config after the previous push.
      // Schedule the next attempt with exponential backoff instead of
      // repushing every reconcile tick.
      const next = nextDriftState(drift, {
        fingerprint: options.drift.fingerprint,
        reason: options.drift.reason,
        now,
      });
      reportedState = { ...reportedState, drift: next };
      this.logDrift(deviceId, next, next.fingerprint, "observed");
    }
    await updateDevice(this.options.db, device.id, {
      appliedRevision: latest.revision,
      appliedAt: now,
      lastPushAt: now,
      lastPushError: null,
      manualRoutesEnforcedAt: now,
      ...(reportedState !== device.reportedState ? { reportedState } : {}),
    });
    await this.options.audit.record({
      orgId: device.orgId,
      actorType: "system",
      action: portalFallback
        ? "device.config.pushed_without_wireguard_portal"
        : "device.config.pushed",
      targetType: "device",
      targetId: device.id,
      metadata: { revision: latest.revision, instanceId, portalFallback },
    });
    this.options.logger.info("config pushed", {
      deviceId,
      revision: latest.revision,
      instanceId,
      ...(portalFallback ? { portalFallback: true } : {}),
    });
    this.options.metrics?.inc(METRIC_NAMES.pushes, {
      status: portalFallback ? "pushed-without-portal" : "pushed",
    });
    await this.notifyChanged(deviceId, "config-pushed");
    return { status: "pushed", revision: latest.revision };
  }

  /**
   * `RunNetworkInstance` + wait for the instance to report running. Returns the
   * device's own error text (exactly as reported) instead of throwing, so the
   * caller can distinguish a portal rejection from a transport failure.
   */
  private async applyConfig(
    client: ManagedClient,
    instanceId: string,
    config: manage.NetworkConfig,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await client.remote.runNetworkInstance({
        instId: instanceId,
        config,
        overwrite: true,
        source: manage.ConfigSource.ConfigSourceWeb,
        timeoutMs: 20_000,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return this.waitForRunning(client, instanceId);
  }

  /** Persists the device's portal rejection so the same config is not retried. */
  private async recordPortalRejection(
    device: Device,
    message: string,
    fingerprint: string,
  ): Promise<void> {
    const at = new Date().toISOString();
    const reportedState = withPortalApplyError(device.reportedState, {
      message: message.slice(0, 2000),
      fingerprint,
      at,
    });
    device.reportedState = reportedState;
    await updateDevice(this.options.db, device.id, { reportedState });
    await this.options.audit.record({
      orgId: device.orgId,
      actorType: "system",
      action: "device.wireguard_portal.rejected",
      targetType: "device",
      targetId: device.id,
      metadata: { error: message.slice(0, 500) },
    });
  }

  private async waitForRunning(
    client: ManagedClient,
    instanceId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const attempts = this.options.pollAttempts ?? 15;
    const interval = this.options.pollIntervalMs ?? 400;
    let lastError = "instance did not report running";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const collected = await client.remote.collectNetworkInfo([instanceId]);
        const info = collected.info?.map[instanceId];
        if (info?.running) return { ok: true };
        if (info?.errorMsg) lastError = info.errorMsg;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (client.isClosed) return { ok: false, error: "client disconnected" };
      await sleep(interval);
    }
    return { ok: false, error: lastError };
  }

  /**
   * Classifies a client whose instance file is read-only. The observation is
   * persisted so the heartbeat path (and the UI) stop retrying it.
   */
  private async markConfigReadOnly(device: Device, message: string): Promise<void> {
    const state =
      device.reportedState && typeof device.reportedState === "object"
        ? (device.reportedState as Record<string, unknown>)
        : {};
    const current = typeof state.managedConfigPermission === "number" ? state.managedConfigPermission : 0;
    if ((current & CONFIG_PERMISSION_READ_ONLY) !== 0 && !device.lastPushError) return;
    await updateDevice(this.options.db, device.id, {
      reportedState: {
        ...state,
        managedConfigPermission: current | CONFIG_PERMISSION_READ_ONLY,
      },
      lastPushError: null,
    });
    this.options.logger.info("device config is locally managed", {
      deviceId: device.id,
      error: message.slice(0, 200),
    });
  }

  /**
   * Re-reads `config_permission` from the client and persists it. Returns true
   * when the instance is still read-only. A file that was replaced with a
   * writable one (the documented "stop, edit, start" cycle) must not stay stuck
   * in the read-only state.
   */
  private async refreshConfigPermission(
    device: Device,
    client: ManagedClient,
    instanceId: string,
  ): Promise<boolean> {
    try {
      const meta = (
        await client.remote.listNetworkInstanceMeta([instanceId])
      ).metas.find(
        (entry) => (entry.instId ? protoToUuid(entry.instId) : "") === instanceId,
      );
      const permission = meta?.configPermission ?? 0;
      const readOnly = (permission & CONFIG_PERMISSION_READ_ONLY) !== 0;
      const state =
        device.reportedState && typeof device.reportedState === "object"
          ? (device.reportedState as Record<string, unknown>)
          : {};
      if (state.managedConfigPermission !== permission) {
        const next = { ...state, managedConfigPermission: permission };
        await updateDevice(this.options.db, device.id, {
          reportedState: next,
          ...(readOnly ? {} : { lastPushError: null }),
        });
        device.reportedState = next;
      } else if (!readOnly && device.lastPushError) {
        await updateDevice(this.options.db, device.id, { lastPushError: null });
      }
      return readOnly;
    } catch {
      // The instance may be mid-restart; keep the last known state.
      return isConfigReadOnly(device.reportedState);
    }
  }

  private async recordFailure(
    device: Device,
    message: string,
    fingerprint?: string,
  ): Promise<void> {
    this.options.metrics?.inc(METRIC_NAMES.pushes, { status: "failed" });
    const now = new Date();
    let reportedState = device.reportedState;
    if (fingerprint) {
      // A device-side apply error is persistent until the config or the device
      // changes: back off instead of re-running a config that fails to start.
      reportedState = {
        ...reportedState,
        drift: nextDriftState(readDriftState(reportedState), {
          fingerprint,
          reason: `push failed: ${message}`.slice(0, 1000),
          now,
        }),
      };
    }
    await updateDevice(this.options.db, device.id, {
      lastPushError: message.slice(0, 2000),
      lastPushAt: now,
      ...(reportedState !== device.reportedState ? { reportedState } : {}),
    });
    this.options.logger.warn("config push failed", {
      deviceId: device.id,
      error: message.slice(0, 300),
    });
    await this.notifyChanged(device.id, "config-push-failed");
  }

  /** Clears the "device rejected the portal" marker (manual retry only). */
  private async clearPortalRejection(deviceId: string): Promise<void> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device) return;
    const reportedState = withoutPortalApplyError(device.reportedState);
    if (reportedState === device.reportedState) return;
    device.reportedState = reportedState;
    await updateDevice(this.options.db, device.id, { reportedState });
    this.options.logger.info("WireGuard portal rejection cleared for retry", {
      deviceId,
    });
  }

  /**
   * Info-level, throttled drift log: the first observation and every change of
   * the mismatch reasons/attempt is worth an operator line; repeating it every
   * reconcile tick is not. The reasons never contain a secret.
   */
  private logDrift(
    deviceId: string,
    state: { reason: string; attempts: number; nextRetryAt: string },
    fingerprint: string,
    phase: "observed" | "backoff",
  ): void {
    const key = `${fingerprint}:${state.attempts}:${phase}`;
    if (this.lastLoggedDrift.get(deviceId) === key) return;
    this.lastLoggedDrift.set(deviceId, key);
    this.options.logger.info(
      phase === "backoff" ? "config drift persists; push backed off" : "config drift detected",
      {
        deviceId,
        desiredFingerprint: shortFingerprint(fingerprint),
        attempts: state.attempts,
        nextRetryAt: state.nextRetryAt,
        mismatch: state.reason,
      },
    );
  }

  /** Removes the drift record (converged, desired changed, reconnect, retry). */
  private async clearDrift(deviceId: string, reason: string): Promise<void> {
    const device = await getDeviceById(this.options.db, deviceId);
    if (!device) return;
    const drift = readDriftState(device.reportedState);
    if (!drift) {
      this.lastLoggedDrift.delete(deviceId);
      return;
    }
    const reportedState = withoutDriftState(device.reportedState);
    await updateDevice(this.options.db, device.id, { reportedState });
    this.lastLoggedDrift.delete(deviceId);
    this.options.logger.info("config drift cleared", {
      deviceId,
      reason,
      attempts: drift.attempts,
    });
  }

  /**
   * One info line per generation change: the operator needs to know why the
   * panel is not pushing a portal to this hub instead of debugging a silent
   * no-op (2.6.x cannot receive `vpn_portal_config` at all).
   */
  private logLegacyPortalOnce(device: Device, mode: WireguardPortalMode): void {
    const key = `portal-mode:${mode}`;
    if (this.lastLoggedDrift.get(device.id) === key) return;
    this.lastLoggedDrift.set(device.id, key);
    this.options.logger.info(
      "hub uses the legacy WireGuard portal; per-client portal is not pushed",
      {
        deviceId: device.id,
        easytierVersion: device.easytierVersion,
        mode,
        hint:
          mode === "legacy"
            ? "configure --vpn-portal on the device; the panel reads the shared client config back"
            : "the reported EasyTier version could not be parsed; per-client portal is disabled",
      },
    );
  }

  /** Records a detected portal generation on the device (no secret). */
  private async persistPortalMode(
    device: Device,
    mode: "per-client" | "legacy",
  ): Promise<void> {
    if (device.reportedState.wgPortalMode === mode) return;
    const reportedState = { ...device.reportedState, wgPortalMode: mode };
    device.reportedState = reportedState;
    await updateDevice(this.options.db, device.id, { reportedState });
    this.options.logger.info("WireGuard portal generation detected", {
      deviceId: device.id,
      mode,
      easytierVersion: device.easytierVersion,
    });
  }

  private async notifyChanged(deviceId: string, reason: string): Promise<void> {
    if (!this.options.onDeviceUpdated) return;
    try {
      await this.options.onDeviceUpdated(deviceId, reason);
    } catch (error) {
      this.options.logger.debug("device update notification failed", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Asks the client what it actually runs and stores it for the routes page:
   * which instances exist, which proxy CIDRs they advertise, whether one is an
   * exit node, and whether an instance is not the one we manage (that one
   * cannot be revoked from here).
   */
  async collectReport(device: Device, client: ManagedClient): Promise<void> {
    if (!this.options.recordReport || client.isClosed) return;
    const last = this.lastReportAt.get(device.id) ?? 0;
    const interval = this.options.reportIntervalMs ?? 30_000;
    if (Date.now() - last < interval) return;
    this.lastReportAt.set(device.id, Date.now());
    try {
      const network = await getNetworkById(this.options.db, device.networkId);
      if (!network) return;
      const managedId = instanceIdFor(network.id, device.id);
      const collected = await client.remote.collectNetworkInfo([]);
      const entries = Object.entries(collected.info?.map ?? {});
      const ids = entries.map(([id]) => id);
      const metas = ids.length > 0
        ? (await client.remote.listNetworkInstanceMeta(ids)).metas
        : [];
      const metaById = new Map(
        metas.map((meta) => [meta.instId ? protoToUuid(meta.instId) : "", meta]),
      );
      const managedMeta = metaById.get(managedId);
      const configPermission = managedMeta?.configPermission ?? 0;
      let managedConfigRead = false;
      let managedExitNode = false;
      let managedProxyCidrs: string[] = [];
      if (ids.includes(managedId)) {
        try {
          const config = await client.remote.getNetworkInstanceConfig(managedId);
          managedExitNode = Boolean(config.config?.enableExitNode);
          managedProxyCidrs = config.config?.proxyCidrs ?? [];
          managedConfigRead = true;
        } catch {
          // The instance may be mid-restart, or the file is read-only (that
          // path refuses even the read). The CIDR report is still useful.
        }
      }
      if (
        (configPermission & CONFIG_PERMISSION_READ_ONLY) !== 0 &&
        device.lastPushError
      ) {
        await updateDevice(this.options.db, device.id, { lastPushError: null });
      }
      const instances: ReportedInstance[] = [];
      const peerObservations: Array<{
        ipv4: string;
        hostname: string;
        proxyCidrs: string[];
      }> = [];
      for (const [id, info] of entries) {
        const meta = metaById.get(id);
        if (meta && meta.networkName !== network.networkName) continue;
        const configured = id === managedId ? managedProxyCidrs : [];
        instances.push({
          instanceId: id,
          networkName: meta?.networkName ?? network.networkName,
          hostname: info.myNodeInfo?.hostname ?? "",
          proxyCidrs: configured,
          exitNode: id === managedId ? managedExitNode : false,
          unmanaged: id !== managedId,
          removable: id === managedId,
        });
        // CollectNetworkInfo lists peers only, never the local node, so this
        // is how the control plane learns what others advertise.
        for (const route of info.routes ?? []) {
          const addr = route.ipv4Addr?.address?.addr;
          if (addr === undefined || addr === null) continue;
          peerObservations.push({
            ipv4: formatIpv4(addr >>> 0),
            hostname: route.hostname ?? "",
            proxyCidrs: route.proxyCidrs ?? [],
          });
        }
      }
      await this.options.recordReport(device, {
        instances,
        peerObservations,
        configPermission,
        ...(managedConfigRead
          ? {
              declared: {
                subnetCidrs: managedProxyCidrs,
                exitNode: managedExitNode,
              },
            }
          : {}),
      });
    } catch (error) {
      this.options.logger.debug("route report failed", {
        deviceId: device.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Periodic convergence check for every online, approved device. */
  async reconcile(): Promise<void> {
    if (this.stopped) return;
    for (const deviceId of this.options.sessions.onlineDeviceIds()) {
      try {
        const result = await this.ensure(deviceId);
        if (result.status !== "skipped") {
          const device = await getDeviceById(this.options.db, deviceId);
          const client = this.options.sessions.get(deviceId);
          if (device && client) await this.collectReport(device, client);
        }
      } catch (error) {
        this.options.logger.debug("reconcile device failed", {
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
