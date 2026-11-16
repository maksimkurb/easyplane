import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";

import {
  authed,
  bootstrapAdmin,
  createTestApp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

function stubClient(id: string): ManagedClient {
  return {
    id,
    isClosed: false,
    close: () => undefined,
    latestHeartbeat: undefined,
    remoteAddress: "127.0.0.1",
    transportKind: "ws",
    secure: true,
  } as unknown as ManagedClient;
}

interface DeviceDto {
  id: string;
  hostname: string;
  virtualIpv4: string | null;
  exitNode: "none" | "proposed" | "approved";
  configManagedLocally: boolean;
  lastPushError: string | null;
}

interface RouteDto {
  id: string;
  deviceId: string;
  kind: "subnet" | "exit_node";
  cidr: string;
  state: "pending" | "approved" | "rejected";
  source: "panel" | "device_declared";
  advertised: boolean;
  lastDeclaredAt: string | null;
}

describe("device-declared routes: proposals, decisions and read-only state", () => {
  let test: TestApp;
  let admin: LoginResult;
  let networkId = "";
  let token = "";
  let router: DeviceDto;
  let receiver: DeviceDto;

  function headers(extra: Record<string, string> = {}) {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  async function enrol(hostname: string, machineId: string): Promise<DeviceDto> {
    const client = stubClient(`session-${machineId}`);
    await test.context.devices.handleHeartbeat({
      token,
      machineId,
      hostname,
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client,
    });
    test.context.deviceSessions.unbindClient(client);
    const list = await test.app.inject({
      method: "GET",
      url: `/api/devices?networkId=${networkId}`,
      headers: authed(admin),
    });
    const device = (list.json() as DeviceDto[]).find((entry) => entry.hostname === hostname);
    if (!device) throw new Error(`device ${hostname} not found`);
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    return approved.json() as DeviceDto;
  }

  async function deviceRow(id: string) {
    const row = await test.context.db.query.devices.findFirst({
      where: (table, { eq }) => eq(table.id, id),
    });
    if (!row) throw new Error("device row missing");
    return row;
  }

  async function sendReport(
    id: string,
    declared: { subnetCidrs: string[]; exitNode: boolean } | undefined,
    configPermission = 0,
  ) {
    const row = await deviceRow(id);
    return test.context.routes.recordReport(row, {
      instances: [
        {
          instanceId: "managed-instance",
          networkName: "declared-routes",
          hostname: row.hostname,
          proxyCidrs: declared?.subnetCidrs ?? [],
          exitNode: Boolean(declared?.exitNode),
          unmanaged: false,
          removable: true,
        },
      ],
      peerObservations: [],
      configPermission,
      ...(declared ? { declared } : {}),
    });
  }

  async function routes(deviceId: string): Promise<RouteDto[]> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${deviceId}/routes`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as RouteDto[];
  }

  async function getDevice(id: string): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  beforeAll(async () => {
    test = await createTestApp({
      oidc: false,
      env: { EASYPLANE_RECONCILE_INTERVAL_MS: "600000" },
    });
    admin = await bootstrapAdmin(test);
    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Declared routes", ipv4Cidr: "10.77.0.0/24" },
    });
    expect(network.statusCode).toBe(201);
    networkId = (network.json() as { id: string }).id;
    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { maxUses: null, expiresInHours: null },
    });
    token = (invite.json() as { token: string }).token;
    router = await enrol("router", "11111111-1111-4111-8111-111111111111");
    receiver = await enrol("receiver", "22222222-2222-4222-8222-222222222222");
  });

  afterAll(async () => {
    await test?.stop();
  });

  it("creates idempotent pending proposals from the device's own config", async () => {
    const routeReport = await sendReport(router.id, {
      // 0.0.0.0/0 and the overlay itself must be filtered out.
      subnetCidrs: ["10.55.1.0/24", "0.0.0.0/0", "10.77.0.0/24"],
      exitNode: true,
    });
    expect(routeReport.declaredCidrs).toEqual(["10.55.1.0/24"]);
    // Not distributable: 0.0.0.0/0 is an exit node, the overlay is the network
    // itself. They stay visible as unapproved drift, but become no proposal.
    expect(routeReport.unapprovedCidrs).toEqual(["0.0.0.0/0", "10.77.0.0/24"]);

    const first = await routes(router.id);
    expect(first).toHaveLength(2);
    const subnet = first.find((route) => route.kind === "subnet")!;
    expect(subnet).toMatchObject({
      cidr: "10.55.1.0/24",
      state: "pending",
      source: "device_declared",
      advertised: true,
    });
    expect(subnet.lastDeclaredAt).not.toBeNull();
    const exit = first.find((route) => route.kind === "exit_node")!;
    expect(exit).toMatchObject({
      cidr: "",
      state: "pending",
      source: "device_declared",
      advertised: true,
    });

    // A second report is not a second proposal.
    await sendReport(router.id, {
      subnetCidrs: ["10.55.1.0/24"],
      exitNode: true,
    });
    expect(await routes(router.id)).toHaveLength(2);

    const audit = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=200",
      headers: authed(admin),
    });
    const dump = audit.body;
    const declaredAudits = dump.split("route.declared").length - 1;
    expect(declaredAudits).toBe(2);

    expect((await getDevice(router.id)).exitNode).toBe("proposed");
    expect((await getDevice(receiver.id)).exitNode).toBe("none");
  });

  it("approves and rejects declared proposals without resurrecting rejections", async () => {
    const rows = await routes(router.id);
    const subnet = rows.find((route) => route.kind === "subnet")!;
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/routes/${subnet.id}/decision`,
      headers: headers(),
      payload: { state: "approved" },
    });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as RouteDto).state).toBe("approved");

    const exit = rows.find((route) => route.kind === "exit_node")!;
    const approvedExit = await test.app.inject({
      method: "POST",
      url: `/api/routes/${exit.id}/decision`,
      headers: headers(),
      payload: { state: "approved" },
    });
    expect(approvedExit.statusCode).toBe(200);
    expect((await getDevice(router.id)).exitNode).toBe("approved");
    // Approval is consent only: no receiver is ever told to use an exit node.
    const receiverRow = await deviceRow(receiver.id);
    expect(receiverRow.reportedState).toEqual({});

    // A newly declared CIDR becomes its own proposal and can be rejected once.
    await sendReport(router.id, {
      subnetCidrs: ["10.55.1.0/24", "10.55.2.0/24"],
      exitNode: true,
    });
    const declared = (await routes(router.id)).find(
      (route) => route.cidr === "10.55.2.0/24",
    )!;
    expect(declared.state).toBe("pending");
    const rejected = await test.app.inject({
      method: "POST",
      url: `/api/routes/${declared.id}/decision`,
      headers: headers(),
      payload: { state: "rejected" },
    });
    expect(rejected.statusCode).toBe(200);
    expect((rejected.json() as RouteDto).state).toBe("rejected");

    // The device keeps advertising it; a later report must not re-propose it.
    const routeReport = await sendReport(router.id, {
      subnetCidrs: ["10.55.1.0/24", "10.55.2.0/24"],
      exitNode: true,
    });
    // It is advertised but not approved, so it is honest drift again.
    expect(routeReport.unapprovedCidrs).toContain("10.55.2.0/24");
    const after = await routes(router.id);
    expect(after.find((route) => route.cidr === "10.55.2.0/24")?.state).toBe("rejected");
    expect(after).toHaveLength(3);
  });

  it("treats a read-only client config as a state, not a push error", async () => {
    await sendReport(router.id, {
      subnetCidrs: ["10.55.1.0/24"],
      exitNode: true,
    }, 3);
    const device = await getDevice(router.id);
    expect(device.configManagedLocally).toBe(true);

    const result = await test.context.push.pushNow(router.id);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("read-only");
    expect((await getDevice(router.id)).lastPushError).toBeNull();

    const audit = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=200",
      headers: authed(admin),
    });
    expect(audit.body).not.toContain("device.config.push_failed");
  });

  it("expires the advertised flag without withdrawing the proposal", async () => {
    await sendReport(router.id, {
      subnetCidrs: ["10.55.1.0/24"],
      exitNode: true,
    });
    const subnet = (await routes(router.id)).find(
      (route) => route.cidr === "10.55.1.0/24",
    )!;
    expect(subnet.advertised).toBe(true);
    // Pretend the last report that showed it is older than the window.
    await test.database.pool.query(
      "UPDATE device_routes SET last_declared_at = $1 WHERE id = $2",
      [new Date(Date.now() - 30 * 60_000), subnet.id],
    );
    const stale = (await routes(router.id)).find(
      (route) => route.cidr === "10.55.1.0/24",
    )!;
    expect(stale.advertised).toBe(false);
    // Still remembered, still approved: no auto-withdraw.
    expect(stale.state).toBe("approved");
    expect(stale.lastDeclaredAt).not.toBeNull();
  });

  it("keeps the panel-side request flow unchanged", async () => {
    const requested = await test.app.inject({
      method: "POST",
      url: `/api/devices/${receiver.id}/routes`,
      headers: headers(),
      payload: { kind: "subnet", cidr: "10.55.3.0/24", note: "panel request" },
    });
    expect(requested.statusCode).toBe(201);
    const route = requested.json() as RouteDto;
    expect(route.source).toBe("panel");
    expect(route.state).toBe("pending");
    expect(route.advertised).toBe(false);
    expect((await getDevice(receiver.id)).exitNode).toBe("none");
  });
});
