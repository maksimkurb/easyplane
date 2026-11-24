import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manage } from "@easyplane/proto";
import { instanceIdFor } from "@easyplane/server";

import {
  PORTS,
  prepareDockerConformanceEnvironment,
  safeStringify,
  startCore,
  stopAllCores,
  type CoreHandle,
} from "./helpers/index.js";
import {
  TEST_HOST,
  authed,
  bootstrapAdmin,
  createTestApp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

interface DeviceDto {
  id: string;
  state: "pending" | "approved" | "blocked";
  online: "online" | "offline";
  sync: "not-applicable" | "in-sync" | "stale" | "error";
  hostname: string;
  virtualIpv4: string | null;
  desiredRevision: number | null;
  appliedRevision: number | null;
  lastPushError: string | null;
}

interface NetworkDto {
  id: string;
  networkName: string;
}

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label}: condition not met within ${timeoutMs}ms; last=${safeStringify(last)}`,
  );
}

describe("M1 conformance: invite -> pending -> approve -> config -> status -> block", () => {
  const inviteMachineHost = "core-ws";
  let test: TestApp;
  let admin: LoginResult;
  let network: NetworkDto;
  let secret = "";
  let inviteToken = "";
  let device: DeviceDto;
  let core: CoreHandle;

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  async function getDevices(): Promise<DeviceDto[]> {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto[];
  }

  async function getDevice(): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${device.id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_WS_PORT: String(PORTS.m1),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "3000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE: "30",
      },
    });
    await test.context.controlPlane.start();
    test.context.push.start(1000);
    admin = await bootstrapAdmin(test);
  });

  afterAll(async () => {
    stopAllCores();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("creates a network and a reusable invite through the API", async () => {
    const networkResponse = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "M1 Conformance", ipv4Cidr: "10.231.0.0/24" },
    });
    expect(networkResponse.statusCode).toBe(201);
    network = networkResponse.json() as NetworkDto;

    const revealed = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/secret/reveal`,
      headers: headers(),
    });
    secret = (revealed.json() as { secret: string }).secret;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${network.id}/invites`,
      headers: headers(),
      payload: { label: "m1", maxUses: null, expiresInHours: null },
    });
    expect(invite.statusCode).toBe(201);
    inviteToken = (invite.json() as { token: string }).token;

    const stored = await test.context.db.query.invites.findFirst();
    expect(stored?.tokenHash).toHaveLength(64);
    expect(stored?.tokenHash).not.toBe(inviteToken);
  });

  it("enrols the real easytier-core as PENDING and gives it no config", async () => {
    core = startCore(
      "core-ws",
      `ws://127.0.0.1:${PORTS.m1}/${encodeURIComponent(inviteToken)}`,
    );
    const client = await test.context.controlPlane.waitForClient({
      timeoutMs: 60_000,
    });
    await client.waitForHeartbeats(2, 30_000);
    expect(client.latestHeartbeat?.hostname).toBe(inviteMachineHost);
    expect(client.latestHeartbeat?.machineId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );

    device = await poll(
      "pending device",
      async () => (await getDevices())[0]!,
      (value) => value?.state === "pending",
    );
    expect(device).toMatchObject({
      state: "pending",
      online: "online",
      sync: "not-applicable",
      desiredRevision: null,
      appliedRevision: null,
    });

    // The real client proves it runs nothing while pending.
    const instances = await client.remote.listNetworkInstance();
    expect(instances).toEqual([]);
  });

  it("approves, pushes revision 1 and the real client runs the config", async () => {
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    device = await poll(
      "applied revision 1",
      getDevice,
      (value) => value.appliedRevision === 1,
    );
    expect(device).toMatchObject({
      state: "approved",
      online: "online",
      sync: "in-sync",
      desiredRevision: 1,
      appliedRevision: 1,
      lastPushError: null,
    });
    expect(device.virtualIpv4).toMatch(/^10\.231\.0\.\d+$/);

    const client = test.context.controlPlane.listClients()[0]!;
    const instanceId = instanceIdFor(network.id, device.id);

    const running = await poll(
      "instance running",
      async () => {
        const collected = await client.remote.collectNetworkInfo([
          instanceId,
        ]);
        return collected.info?.map[instanceId];
      },
      (info) => info?.running === true,
      30_000,
    );
    expect(running?.myNodeInfo?.hostname).toBe(inviteMachineHost);

    const pushed = await client.remote.getNetworkInstanceConfig(instanceId);
    expect(pushed.config?.networkName).toBe(network.networkName);
    expect(pushed.config?.networkSecret).toBe(secret);
    expect(pushed.source).toBe(manage.ConfigSource.ConfigSourceWeb);

    const listed = await client.remote.listNetworkInstance();
    expect(listed).toContain(instanceId);
  });

  it("pushes a new revision on change and tracks desired vs applied", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/revisions`,
      headers: headers(),
      payload: {
        config: {
          noTun: process.env.EASYPLANE_CONFORMANCE_NO_TUN === "1",
          mtu: 1400,
        },
        note: "conformance revision 2",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(
      (response.json() as { revision: { revision: number } }).revision.revision,
    ).toBe(2);

    device = await poll(
      "applied revision 2",
      getDevice,
      (value) => value.appliedRevision === 2,
    );
    expect(device.sync).toBe("in-sync");

    const client = test.context.controlPlane.listClients()[0]!;
    const instanceId = instanceIdFor(network.id, device.id);
    const pushed = await client.remote.getNetworkInstanceConfig(instanceId);
    expect(pushed.config?.mtu).toBe(1400);
    expect(pushed.config?.noTun).toBe(
      process.env.EASYPLANE_CONFORMANCE_NO_TUN === "1",
    );

    // The hostname is device identity: renaming is its own endpoint and keeps
    // the revision history intact.
    const renamed = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${device.id}/hostname`,
      headers: headers(),
      payload: { dnsName: "m1-revised" },
    });
    expect(renamed.statusCode).toBe(200);
    await poll(
      "renamed hostname on the client",
      async () => (await client.remote.getNetworkInstanceConfig(instanceId)).config,
      (config) => config?.hostname === "m1-revised",
    );
    device = await getDevice();
  });

  it("rolls back to revision 1 on the real client", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/revisions/1/rollback`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(201);
    expect(
      (response.json() as { revision: { revision: number } }).revision.revision,
    ).toBe(4);

    device = await poll(
      "applied revision 4",
      getDevice,
      (value) => value.appliedRevision === 4,
    );
    const client = test.context.controlPlane.listClients()[0]!;
    const instanceId = instanceIdFor(network.id, device.id);
    const pushed = await client.remote.getNetworkInstanceConfig(instanceId);
    // The rename survives a rollback; revision 1's mtu/noTun come back.
    expect(pushed.config?.hostname).toBe("m1-revised");
    // The client reports its build default (1380) when no MTU is pushed.
    expect(pushed.config?.mtu).not.toBe(1400);
    expect(pushed.config?.enableMagicDns).toBe(false);
  });

  it("reports offline and online from real heartbeats", async () => {
    core.stop();
    await poll(
      "device offline",
      getDevice,
      (value) => value.online === "offline",
      30_000,
    );

    core.start();
    const reconnected = await test.context.controlPlane.waitForClient({
      timeoutMs: 60_000,
    });
    await reconnected.waitForHeartbeats(2, 30_000);
    device = await poll(
      "device online",
      getDevice,
      (value) => value.online === "online",
      30_000,
    );
    // The reconnected client is verified/re-pushed but the desired revision
    // does not change. (The rename above added revision 3.)
    device = await poll(
      "revision retained",
      getDevice,
      (value) => value.appliedRevision === 4 && value.sync === "in-sync",
      60_000,
    );
  });

  it("blocks the device and refuses further heartbeats", async () => {
    const response = await test.app.inject({
      method: "POST",
      url: `/api/devices/${device.id}/block`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);

    device = await poll("blocked state", getDevice, (value) => value.state === "blocked");
    expect(device).toMatchObject({
      state: "blocked",
      online: "offline",
      sync: "not-applicable",
    });

    await poll(
      "session closed",
      async () => test.context.controlPlane.listClients().length,
      (count) => count === 0,
      30_000,
    );

    core.stop();
    core.start();
    // Give the rejected client several 1 s retry attempts. The server accepts a
    // TCP/WS session before the first heartbeat can be rejected, so assert that
    // no session gets past its first heartbeat and that the client logs the
    // rejection.
    await poll(
      "no lasting session after block",
      async () =>
        test.context.controlPlane
          .listClients()
          .filter((client) => client.heartbeatCount >= 2).length,
      (count) => count === 0,
      15_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const logs = core.logs();
    // The server closes the session of a blocked device on its first heartbeat.
    // Depending on timing the client reports that as a failed heartbeat RPC or
    // as the peer RPC transport closing first; both are the same rejection.
    expect(logs).toMatch(
      /config-server heartbeat failed|peer rpc transport read aborted|recv close message/,
    );
    const after = await getDevice();
    expect(after.state).toBe("blocked");
    expect(after.appliedRevision).toBe(4);

    const auditResponse = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=200",
      headers: authed(admin),
    });
    const auditDump = JSON.stringify(auditResponse.json());
    expect(auditDump).toContain("device.joined");
    expect(auditDump).toContain("device.approved");
    expect(auditDump).toContain("device.config.pushed");
    expect(auditDump).toContain("device.blocked");
    expect(auditDump).toContain('"instanceStopped":true');
    expect(auditDump).not.toContain(secret);
    expect(auditDump).not.toContain(inviteToken);
  }, 180_000);
});
