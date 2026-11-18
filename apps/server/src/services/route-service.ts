import type { DbExecutor } from "../db/repositories.js";
import {
  decideDeviceRoute,
  getDevice,
  getDeviceRoute,
  getNetworkById,
  insertDeclaredDeviceRoute,
  listDevicesInNetwork,
  listDeviceRoutes,
  listNetworkRoutes,
  touchDeviceRouteDeclarations,
  updateDevice,
  upsertDeviceRoute,
} from "../db/repositories.js";
import type { Device, DeviceRoute } from "../db/schema.js";
import {
  buildRouteReport,
  normalizeRouteReport,
  cidrContains,
  declarableCidr,
  isDeclaredRouteAdvertised,
  mergePeerObservations,
  validateSubnetRequest,
  type PeerObservation,
  type PeerObservationRecord,
  type ReportedInstance,
  type RouteReport,
  type RouteSource,
} from "../domain/routes.js";
import { AppError, conflict, invalid, notFound } from "./errors.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { AuditService } from "./audit.js";
import { pushNetworkDevices, type PushService } from "./push-service.js";
import type { RequestActor } from "./device-service.js";

export interface DeviceRouteDto {
  id: string;
  networkId: string;
  deviceId: string;
  deviceHostname: string;
  kind: "subnet" | "exit_node";
  cidr: string;
  state: "pending" | "approved" | "rejected";
  /** `panel` = requested by a user; `device_declared` = advertised by the device. */
  source: RouteSource;
  note: string;
  /** Last report that showed a `device_declared` route in the own config. */
  lastDeclaredAt: string | null;
  /** `device_declared` row seen within the advertised window. */
  advertised: boolean;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RouteReportDto {
  deviceId: string;
  deviceHostname: string;
  /** Null when no report has been collected yet. */
  report: RouteReport | null;
  collectedAt: string | null;
}

export interface RouteServiceOptions {
  db: DbExecutor;
  audit: AuditService;
  push: PushService;
  /** Live browser fan-out; optional so unit tests can omit it. */
  realtime?: RealtimeHub;
}

const REPORT_KEY = "routeReport";

function toDto(route: DeviceRoute, hostname: string, now = Date.now()): DeviceRouteDto {
  const source = (route.source === "device_declared" ? "device_declared" : "panel") as RouteSource;
  return {
    id: route.id,
    networkId: route.networkId,
    deviceId: route.deviceId,
    deviceHostname: hostname,
    kind: route.kind,
    cidr: route.cidr,
    state: route.state,
    source,
    note: route.note,
    lastDeclaredAt: route.lastDeclaredAt?.toISOString() ?? null,
    advertised:
      source === "device_declared" &&
      isDeclaredRouteAdvertised(route.lastDeclaredAt, now),
    requestedBy: route.requestedBy,
    decidedBy: route.decidedBy,
    decidedAt: route.decidedAt?.toISOString() ?? null,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  };
}

/**
 * Subnet/exit-node approval workflow.
 *
 * A device cannot call the HTTP API, so a member or admin requests routes on
 * its behalf. `approved` rows are the only ones compiled into the pushed
 * config (`proxy_cidrs` / `enable_exit_node`).
 */
export class RouteService {
  constructor(private readonly options: RouteServiceOptions) {}

  private get db(): DbExecutor {
    return this.options.db;
  }

  private async hostnames(devices: readonly Device[]): Promise<Map<string, string>> {
    return new Map(
      devices.map((device) => [device.id, device.dnsName ?? device.hostname]),
    );
  }

  async listForNetwork(
    actor: RequestActor,
    networkId: string,
  ): Promise<{ routes: DeviceRouteDto[]; reports: RouteReportDto[] }> {
    const network = await getNetworkById(this.db, networkId);
    if (!network || network.orgId !== actor.orgId) notFound("network not found");
    const rows = await listNetworkRoutes(this.db, networkId);
    const devices = await this.db.query.devices.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.orgId, actor.orgId), eq(table.networkId, networkId)),
    });
    const names = await this.hostnames(devices);
    const routes = rows.map((row) => toDto(row, names.get(row.deviceId) ?? ""));
    const approvals = rows.map((row) => ({
      deviceId: row.deviceId,
      kind: row.kind,
      cidr: row.cidr,
      state: row.state,
      source: (row.source === "device_declared"
        ? "device_declared"
        : "panel") as RouteSource,
    }));
    const reports: RouteReportDto[] = devices.map((device) => {
      const stored = this.reportOf(device);
      const observations = this.observationsOf(device);
      return {
        deviceId: device.id,
        deviceHostname: names.get(device.id) ?? "",
        report: stored
          ? mergePeerObservations(stored, observations, approvals, device.id)
          : stored,
        collectedAt: device.reportedStateAt?.toISOString() ?? null,
      };
    });
    return { routes, reports };
  }

  async listForDevice(actor: RequestActor, deviceId: string): Promise<DeviceRouteDto[]> {
    const device = await getDevice(this.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    const rows = await listDeviceRoutes(this.db, deviceId);
    return rows.map((row) => toDto(row, device.dnsName ?? device.hostname));
  }

  async request(
    actor: RequestActor,
    deviceId: string,
    input: { kind: "subnet" | "exit_node"; cidr?: string; note?: string },
  ): Promise<DeviceRouteDto> {
    const device = await getDevice(this.db, actor.orgId, deviceId);
    if (!device) notFound("device not found");
    if (device.state !== "approved") {
      conflict("only approved devices can request routes");
    }
    const existing = await listDeviceRoutes(this.db, deviceId);

    let cidr = "";
    if (input.kind === "subnet") {
      if (!input.cidr) invalid("a subnet route needs a CIDR");
      // Overlap is a network-wide property: two devices serving the same CIDR
      // would make the overlay route ambiguous.
      const networkRoutes = (await listNetworkRoutes(this.db, device.networkId))
        .filter((row) => row.deviceId !== deviceId)
        .map((row) => ({
          deviceId: row.deviceId,
          kind: row.kind,
          cidr: row.cidr,
          state: row.state,
        }));
      try {
        cidr = validateSubnetRequest(
          input.cidr,
          [
            ...existing.map((row) => ({
              deviceId: row.deviceId,
              kind: row.kind,
              cidr: row.cidr,
              state: row.state,
            })),
            ...networkRoutes,
          ],
          deviceId,
        ).cidr;
      } catch (error) {
        invalid(error instanceof Error ? error.message : "invalid route");
      }
      // The route must not swallow (or sit inside) the overlay itself.
      const network = await getNetworkById(this.db, device.networkId);
      if (network) {
        if (
          cidrContains(cidr, network.ipv4Cidr) ||
          cidrContains(network.ipv4Cidr, cidr)
        ) {
          invalid("the route overlaps the network's own address range");
        }
      }
    } else {
      cidr = "";
      const already = existing.find(
        (row) => row.kind === "exit_node" && row.state !== "rejected",
      );
      if (already) {
        if (already.state === "approved") {
          conflict("this device is already an approved exit node");
        }
        return toDto(already, device.dnsName ?? device.hostname);
      }
    }

    const row = await upsertDeviceRoute(this.db, {
      orgId: actor.orgId,
      networkId: device.networkId,
      deviceId,
      kind: input.kind,
      cidr,
      requestedBy: actor.userId,
      note: input.note ?? "",
    });
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "route.requested",
      targetType: "device",
      targetId: deviceId,
      metadata: { kind: input.kind, cidr, networkId: device.networkId },
    });
    this.options.realtime?.publish({
      type: "route.updated",
      orgId: actor.orgId,
      networkId: device.networkId,
      deviceId,
      data: { networkId: device.networkId, routeId: row.id, deviceId },
    });
    return toDto(row, device.dnsName ?? device.hostname);
  }

  async decide(
    actor: RequestActor,
    routeId: string,
    input: { state: "approved" | "rejected"; note?: string },
  ): Promise<DeviceRouteDto> {
    const route = await getDeviceRoute(this.db, routeId);
    if (!route || route.orgId !== actor.orgId) notFound("route not found");
    const device = await getDevice(this.db, actor.orgId, route.deviceId);
    if (!device) notFound("device not found");
    const updated = await decideDeviceRoute(this.db, routeId, {
      state: input.state,
      decidedBy: actor.userId,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    if (!updated) throw new AppError(500, "failed to update route");
    await this.options.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: `route.${input.state}`,
      targetType: "device",
      targetId: route.deviceId,
      metadata: {
        kind: route.kind,
        cidr: route.cidr,
        networkId: route.networkId,
        note: input.note ?? "",
      },
    });
    // Only now does the route enter the pushed config. Every device needs the
    // update: the advertiser's own config and the receivers' manual-route list
    // both depend on the approval set.
    await pushNetworkDevices(
      this.db,
      this.options.push,
      route.networkId,
      `route ${input.state}`,
    );
    this.options.realtime?.publish({
      type: "route.updated",
      orgId: actor.orgId,
      networkId: route.networkId,
      deviceId: route.deviceId,
      data: { networkId: route.networkId, routeId, deviceId: route.deviceId },
    });
    return toDto(updated, device.dnsName ?? device.hostname);
  }

  /**
   * Stores the latest route report collected from one client.
   *
   * `instances` is what the device's own instances are configured with;
   * `peerObservations` is what this device sees other members advertising, which
   * is how the control plane learns a device's real proxy CIDRs (EasyTier
   * excludes the local peer from its own route list).
   */
  async recordReport(
    device: Device,
    payload: {
      instances: readonly ReportedInstance[];
      peerObservations: readonly PeerObservation[];
      declared?: { subnetCidrs: string[]; exitNode: boolean };
      configPermission?: number;
    },
  ): Promise<RouteReport> {
    // Detect declarations before building the report so a first-time
    // declaration is already an expected (pending) row, not "unapproved drift".
    await this.declare(device, payload.declared);
    const devices = await listDevicesInNetwork(this.db, device.networkId);
    const networkRoutes = await listNetworkRoutes(this.db, device.networkId);
    const approvals = networkRoutes.map((row) => ({
      deviceId: row.deviceId,
      kind: row.kind,
      cidr: row.cidr,
      state: row.state,
      source: (row.source === "device_declared"
        ? "device_declared"
        : "panel") as RouteSource,
    }));
    const byIp = new Map(
      devices
        .filter((entry) => entry.virtualIpv4)
        .map((entry) => [entry.virtualIpv4!, entry]),
    );

    const report = buildRouteReport({
      approvals,
      deviceId: device.id,
      instances: payload.instances,
      peerObservations: payload.peerObservations,
      knownDeviceIps: devices
        .filter((entry) => entry.virtualIpv4)
        .map((entry) => ({ deviceId: entry.id, ipv4: entry.virtualIpv4! })),
    });
    const previous = this.reportOf(device);
    const previousState =
      device.reportedState && typeof device.reportedState === "object"
        ? (device.reportedState as Record<string, unknown>)
        : {};
    await updateDevice(this.db, device.id, {
      reportedState: {
        ...previousState,
        [REPORT_KEY]: report,
        instances: payload.instances,
        peerObservations: payload.peerObservations,
        ...(payload.configPermission !== undefined
          ? { managedConfigPermission: payload.configPermission }
          : {}),
        checkedAt: new Date().toISOString(),
      },
      reportedStateAt: new Date(),
    });
    await this.auditIfChanged(device, previous, report);

    // Attribute peer observations to the devices they describe.
    const now = new Date().toISOString();
    let changed = false;
    for (const observation of payload.peerObservations) {
      const target = byIp.get(observation.ipv4);
      if (!target || target.id === device.id) continue;
      const state = target.reportedState as Record<string, unknown>;
      const existing = Array.isArray(state.advertisedByPeers)
        ? (state.advertisedByPeers as PeerObservationRecord[])
        : [];
      const previous = existing.find((entry) => entry.observerDeviceId === device.id);
      // Steady state: the same peer sees the same CIDRs; skip the write so a
      // report for N devices is not N² database updates per reconcile tick.
      if (
        previous &&
        previous.ipv4 === observation.ipv4 &&
        JSON.stringify(previous.proxyCidrs) === JSON.stringify(observation.proxyCidrs)
      ) {
        continue;
      }
      changed = true;
      const next: PeerObservationRecord[] = [
        ...existing.filter((entry) => entry.observerDeviceId !== device.id),
        {
          ipv4: observation.ipv4,
          hostname: observation.hostname,
          proxyCidrs: observation.proxyCidrs,
          observerDeviceId: device.id,
          observerHostname: device.dnsName ?? device.hostname,
          at: now,
        },
      ];
      await updateDevice(this.db, target.id, {
        reportedState: { ...state, advertisedByPeers: next },
      });
    }
    if (changed || JSON.stringify(previous) !== JSON.stringify(report)) {
      this.options.realtime?.publish({
        type: "route.updated",
        orgId: device.orgId,
        networkId: device.networkId,
        deviceId: device.id,
        data: { networkId: device.networkId, deviceId: device.id },
      });
    }
    return report;
  }

  private async auditIfChanged(
    device: Device,
    previous: RouteReport | null,
    report: RouteReport,
  ): Promise<void> {
    const before = [
      ...(previous?.unapprovedCidrs ?? []),
      ...(previous?.unapprovedObservedCidrs ?? []),
      ...(previous?.unknownPeers ?? []).flatMap((peer) => peer.proxyCidrs),
    ].sort();
    const after = [
      ...report.unapprovedCidrs,
      ...report.unapprovedObservedCidrs,
      ...report.unknownPeers.flatMap((peer) => peer.proxyCidrs),
    ].sort();
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await this.options.audit.record({
      orgId: device.orgId,
      actorType: "device",
      action: "route.unapproved_reported",
      targetType: "device",
      targetId: device.id,
      metadata: {
        cidrs: report.unapprovedCidrs,
        observedCidrs: report.unapprovedObservedCidrs,
        unknownPeers: report.unknownPeers.map((peer) => ({
          ipv4: peer.ipv4,
          cidrs: peer.proxyCidrs,
        })),
        unmanagedInstances: report.unmanagedInstances.length,
      },
    });
  }

  /**
   * Turns the routes a device advertises in its own persisted config into
   * pending `device_declared` proposals. Idempotent: a repeated report never
   * creates a duplicate, changes a state, or resurrects a rejected row; it only
   * refreshes `last_declared_at` (docs/POLICY.md §7.1).
   */
  async declare(
    device: Device,
    declared: { subnetCidrs: string[]; exitNode: boolean } | undefined,
  ): Promise<void> {
    if (!declared) return;
    const network = await getNetworkById(this.db, device.networkId);
    if (!network) return;
    const rows = await listDeviceRoutes(this.db, device.id);
    const declaredRows: string[] = [];
    const created: DeviceRoute[] = [];

    for (const raw of declared.subnetCidrs) {
      const cidr = declarableCidr(raw, network.ipv4Cidr);
      if (!cidr) continue;
      const existing = rows.find(
        (row) => row.kind === "subnet" && row.cidr === cidr,
      );
      if (existing) {
        if (existing.source === "device_declared") declaredRows.push(existing.id);
        continue;
      }
      const row = await insertDeclaredDeviceRoute(this.db, {
        orgId: device.orgId,
        networkId: device.networkId,
        deviceId: device.id,
        kind: "subnet",
        cidr,
        note: "advertised by the device's own config",
      });
      if (row) {
        created.push(row);
        rows.push(row);
      }
    }

    if (declared.exitNode) {
      const existing = rows.find((row) => row.kind === "exit_node");
      if (existing) {
        if (existing.source === "device_declared") declaredRows.push(existing.id);
      } else {
        const row = await insertDeclaredDeviceRoute(this.db, {
          orgId: device.orgId,
          networkId: device.networkId,
          deviceId: device.id,
          kind: "exit_node",
          cidr: "",
          note: "advertised by the device's own config (exit node)",
        });
        if (row) {
          created.push(row);
          rows.push(row);
        }
      }
    }

    await touchDeviceRouteDeclarations(this.db, declaredRows);
    for (const row of created) {
      await this.options.audit.record({
        orgId: device.orgId,
        actorType: "device",
        action: "route.declared",
        targetType: "device",
        targetId: device.id,
        metadata: {
          kind: row.kind,
          cidr: row.cidr,
          networkId: device.networkId,
        },
      });
    }
    if (created.length > 0) {
      this.options.realtime?.publish({
        type: "route.updated",
        orgId: device.orgId,
        networkId: device.networkId,
        deviceId: device.id,
        data: { networkId: device.networkId, deviceId: device.id },
      });
    }
  }

  reportOf(device: Device): RouteReport | null {
    const state = device.reportedState as Record<string, unknown>;
    return normalizeRouteReport(state[REPORT_KEY]);
  }

  observationsOf(device: Device): PeerObservationRecord[] {
    const state = device.reportedState as Record<string, unknown>;
    return Array.isArray(state.advertisedByPeers)
      ? (state.advertisedByPeers as PeerObservationRecord[])
      : [];
  }
}
