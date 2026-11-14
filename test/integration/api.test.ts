import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ManagedClient } from "@easyplane/server";
import { manage } from "@easyplane/proto";

import {
  TEST_HOST,
  authed,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

const MACHINE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface FakeRunRequest {
  instId: string;
  config: manage.NetworkConfig;
  overwrite?: boolean;
  source?: manage.ConfigSource;
}

interface FakeClient {
  client: ManagedClient;
  close: ReturnType<typeof vi.fn>;
  lastRun: FakeRunRequest | null;
  deleteCalls: number;
}

function fakeClient(id = "session-1"): FakeClient {
  const state = {
    closed: false,
    lastRun: null as FakeRunRequest | null,
    deleteCalls: 0,
  };
  const remote = {
    runNetworkInstance: vi.fn(async (request: FakeRunRequest) => {
      state.lastRun = request;
      return { instId: request.instId };
    }),
    collectNetworkInfo: vi.fn(async (instIds: string[]) => {
      const map: Record<string, manage.NetworkInstanceRunningInfo> = {};
      for (const instanceId of instIds) {
        map[instanceId] = { running: true } as manage.NetworkInstanceRunningInfo;
      }
      return { info: { map } };
    }),
    listNetworkInstance: vi.fn(async () => [] as string[]),
    getNetworkInstanceConfig: vi.fn(async () => ({
      config: state.lastRun?.config,
      source: manage.ConfigSource.ConfigSourceWeb,
    })),
    deleteNetworkInstance: vi.fn(async () => {
      state.deleteCalls += 1;
      return { remainInstIds: [] };
    }),
  };
  const close = vi.fn(() => {
    state.closed = true;
  });
  const client = {
    id,
    get isClosed() {
      return state.closed;
    },
    remote,
    close,
    heartbeatCount: 1,
    transportKind: "ws",
    secure: true,
    remoteAddress: "127.0.0.1",
    latestHeartbeat: undefined,
  } as unknown as ManagedClient;
  return {
    client,
    close,
    get lastRun() {
      return state.lastRun;
    },
    get deleteCalls() {
      return state.deleteCalls;
    },
  };
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== undefined && predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met; last value: ${JSON.stringify(last)}`);
}

describe("networks, invites, devices, desired state and audit", () => {
  let test: TestApp;
  let admin: LoginResult;
  let networkId = "";
  let networkSecret = "";
  let inviteToken = "";
  let deviceId = "";
  let fake: FakeClient;
  let activeFake: FakeClient;

  function headers(extra: Record<string, string> = {}) {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  async function heartbeat(token: string, machineId = MACHINE_ID, client = fakeClient()) {
    await test.context.devices.handleHeartbeat({
      token,
      machineId,
      hostname: "node-a",
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client: client.client,
    });
    activeFake = client;
    return client;
  }

  async function getDevice() {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${deviceId}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      state: string;
      online: string;
      sync: string;
      virtualIpv4: string | null;
      desiredRevision: number | null;
      appliedRevision: number | null;
      lastPushError: string | null;
    };
  }

  beforeAll(async () => {
    test = await createTestApp({
      env: { EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE: "2" },
    });
    admin = await loginWithMockIdp(test, "admin");
  });

  afterAll(async () => {
    await test.stop();
  });

  it("creates a network with a generated name and an encrypted secret", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Lab", ipv4Cidr: "10.144.144.0/24", defaultConfig: { noTun: true } },
    });
    expect(created.statusCode).toBe(201);
    const network = created.json() as {
      id: string;
      networkName: string;
      ipv4Cidr: string;
    };
    networkId = network.id;
    expect(network.networkName).toMatch(/^lab-[0-9a-f]{6}$/);
    expect(network.ipv4Cidr).toBe("10.144.144.0/24");

    const stored = await test.context.db.query.networks.findFirst();
    expect(stored?.secretCiphertext).toMatch(/^v1\./);
    expect(stored?.secretCiphertext).not.toContain(network.networkName);

    const revealed = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/secret/reveal`,
      headers: headers(),
    });
    expect(revealed.statusCode).toBe(200);
    networkSecret = (revealed.json() as { secret: string }).secret;
    expect(networkSecret.length).toBeGreaterThan(20);
  });

  it("creates a single-use invite and stores only its hash", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { label: "first", maxUses: 1, expiresInHours: 1 },
    });
    expect(created.statusCode).toBe(201);
    inviteToken = (created.json() as { token: string }).token;
    expect(inviteToken.length).toBeGreaterThan(20);

    const invites = await test.context.db.query.invites.findMany();
    expect(invites).toHaveLength(1);
    expect(invites[0]!.tokenHash).not.toBe(inviteToken);
    expect(invites[0]!.tokenHash).toHaveLength(64);
  });

  it("rejects unknown tokens and rate-limits the source", async () => {
    const first = fakeClient("bad-1");
    await expect(heartbeat("not-a-real-token-value-1234", MACHINE_ID, first)).rejects.toThrow(
      /unknown config-server token/,
    );
    await expect(
      heartbeat("not-a-real-token-value-5678", MACHINE_ID, fakeClient("bad-2")),
    ).rejects.toThrow(/unknown/);
    const third = fakeClient("bad-3");
    await expect(
      heartbeat("not-a-real-token-value-9999", MACHINE_ID, third),
    ).rejects.toThrow(/unknown/);
    expect(third.close).toHaveBeenCalled();
    expect(await test.context.db.query.devices.findMany()).toHaveLength(0);
  });

  it("enrols a device as PENDING and gives it no config", async () => {
    fake = await heartbeat(inviteToken);
    const device = await waitFor(
      async () => {
        const response = await test.app.inject({
          method: "GET",
          url: `/api/devices?state=pending`,
          headers: authed(admin),
        });
        return (response.json() as Array<{ id: string; state: string }>)[0];
      },
      (value) => value !== undefined,
    );
    deviceId = device.id;

    const dto = await getDevice();
    expect(dto).toMatchObject({
      state: "pending",
      online: "online",
      sync: "not-applicable",
      virtualIpv4: null,
      desiredRevision: null,
      appliedRevision: null,
    });
    expect(activeFake.lastRun).toBeNull();

    const revisions = await test.app.inject({
      method: "GET",
      url: `/api/devices/${deviceId}/revisions`,
      headers: authed(admin),
    });
    expect(revisions.json()).toEqual([]);

    const audit = await test.app.inject({
      method: "GET",
      url: "/api/audit",
      headers: authed(admin),
    });
    expect(
      (audit.json() as Array<{ action: string }>).map((entry) => entry.action),
    ).toContain("device.joined");
  });

  it("allows the enrolled device to reconnect with the exhausted single-use invite", async () => {
    await expect(heartbeat(inviteToken)).resolves.toBeDefined();
  });

  it("refuses a second machine on the exhausted invite", async () => {
    await expect(
      heartbeat(inviteToken, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ).rejects.toThrow(/exhausted/);
  });

  it("approves the device, allocates an address and pushes revision 1", async () => {
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    const dto = await waitFor(getDevice, (value) => value.appliedRevision === 1);
    expect(dto).toMatchObject({
      state: "approved",
      online: "online",
      sync: "in-sync",
      virtualIpv4: "10.144.144.2",
      desiredRevision: 1,
      appliedRevision: 1,
      lastPushError: null,
    });
    expect(activeFake.lastRun?.config?.networkName).toMatch(/^lab-/);
    expect(activeFake.lastRun?.config?.networkSecret).toBe(networkSecret);
    expect(activeFake.lastRun?.source).toBe(manage.ConfigSource.ConfigSourceWeb);
  });

  it("pushes a new revision on change and tracks desired vs applied", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/revisions`,
      headers: headers(),
      payload: {
        config: { hostname: "node-a2", noTun: true, enableMagicDns: true },
        note: "enable magic dns",
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { revision: { revision: number } };
    expect(body.revision.revision).toBe(2);

    const dto = await waitFor(getDevice, (value) => value.appliedRevision === 2);
    expect(dto).toMatchObject({
      desiredRevision: 2,
      appliedRevision: 2,
      sync: "in-sync",
    });
    expect(activeFake.lastRun?.config?.hostname).toBe("node-a2");
    expect(activeFake.lastRun?.config?.enableMagicDns).toBe(true);
  });

  it("rolls back by appending a revision with the old content", async () => {
    const rolled = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/revisions/1/rollback`,
      headers: headers(),
    });
    expect(rolled.statusCode).toBe(201);
    const body = rolled.json() as {
      revision: { revision: number; source: string; rollbackOfRevision: number };
    };
    expect(body.revision).toMatchObject({
      revision: 3,
      source: "rollback",
      rollbackOfRevision: 1,
    });

    const dto = await waitFor(getDevice, (value) => value.appliedRevision === 3);
    expect(dto.desiredRevision).toBe(3);
    expect(activeFake.lastRun?.config?.hostname).toBe("node-a");
    expect(activeFake.lastRun?.config?.enableMagicDns).toBe(false);

    const list = await test.app.inject({
      method: "GET",
      url: `/api/devices/${deviceId}/revisions`,
      headers: authed(admin),
    });
    expect((list.json() as Array<{ revision: number }>).map((r) => r.revision)).toEqual([
      3, 2, 1,
    ]);
  });

  it("records a push error and recovers on the next revision", async () => {
    const remote = activeFake.client.remote as unknown as {
      runNetworkInstance: ReturnType<typeof vi.fn>;
    };
    remote.runNetworkInstance.mockRejectedValueOnce(
      new Error("simulated config error"),
    );

    const failed = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/revisions`,
      headers: headers(),
      payload: { config: { hostname: "broken" }, note: "force failure" },
    });
    expect(failed.statusCode).toBe(201);

    const errored = await waitFor(
      getDevice,
      (value) => (value.lastPushError ?? "").includes("simulated config error"),
    );
    expect(errored).toMatchObject({
      desiredRevision: 4,
      sync: "error",
    });

    const recovered = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/push`,
      headers: headers(),
    });
    expect(recovered.statusCode).toBe(200);

    const healthy = await waitFor(
      getDevice,
      (value) => value.appliedRevision === 4 && value.lastPushError === null,
    );
    expect(healthy.sync).toBe("in-sync");
  });

  it("blocks a device and refuses its heartbeat", async () => {
    // A reconnect replaces the registry entry; block must close the live one.
    const active = await heartbeat(inviteToken);
    const blocked = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/block`,
      headers: headers(),
    });
    expect(blocked.statusCode).toBe(200);
    const dto = await getDevice();
    expect(dto).toMatchObject({
      state: "blocked",
      online: "offline",
      sync: "not-applicable",
    });
    expect(active.deleteCalls).toBe(1);
    expect(active.close).toHaveBeenCalled();

    const reconnect = fakeClient("blocked-session");
    await expect(heartbeat(inviteToken, MACHINE_ID, reconnect)).rejects.toThrow(
      /blocked/,
    );
    expect(reconnect.close).toHaveBeenCalled();
  });

  it("never writes secrets or tokens into the audit log", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=200",
      headers: authed(admin),
    });
    const dump = JSON.stringify(response.json());
    expect(dump).not.toContain(networkSecret);
    expect(dump).not.toContain(inviteToken);
    expect(dump).toContain("device.approved");
    expect(dump).toContain("device.config.pushed");
    expect(dump).toContain("device.config.rollback");
    expect(dump).toContain("device.blocked");
  });

  it("revokes an invite so new machines cannot join", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { maxUses: null, expiresInHours: null },
    });
    const token = (created.json() as { token: string }).token;
    const id = (created.json() as { invite: { id: string } }).invite.id;

    const revoked = await test.app.inject({
      method: "DELETE",
      url: `/api/invites/${id}`,
      headers: headers(),
    });
    expect(revoked.statusCode).toBe(200);
    await expect(
      heartbeat(token, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    ).rejects.toThrow(/revoked/);
  });
});
