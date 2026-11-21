import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";
import { manage } from "@easyplane/proto";

import {
  authed,
  createTestApp,
  loginWithMockIdp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

interface FakeRunRequest {
  instId: string;
  config: manage.NetworkConfig;
}

function fakeClient() {
  const state = { closed: false, lastRun: null as FakeRunRequest | null };
  const remote = {
    runNetworkInstance: async (request: FakeRunRequest) => {
      state.lastRun = request;
      return { instId: request.instId };
    },
    collectNetworkInfo: async (instIds: string[]) => {
      const map: Record<string, manage.NetworkInstanceRunningInfo> = {};
      for (const instanceId of instIds) {
        map[instanceId] = { running: true } as manage.NetworkInstanceRunningInfo;
      }
      return { info: { map } };
    },
    listNetworkInstance: async () => [] as string[],
    getNetworkInstanceConfig: async () => ({
      config: state.lastRun?.config,
      source: manage.ConfigSource.ConfigSourceWeb,
    }),
    deleteNetworkInstance: async () => ({ remainInstIds: [] }),
  };
  const client = {
    id: "hub-session",
    get isClosed() {
      return state.closed;
    },
    remote,
    close: () => {
      state.closed = true;
    },
    heartbeatCount: 1,
    transportKind: "ws",
    secure: true,
    remoteAddress: "127.0.0.1",
    latestHeartbeat: undefined,
  } as unknown as ManagedClient;
  return {
    client,
    get lastRun() {
      return state.lastRun;
    },
  };
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
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

interface DeviceDto {
  id: string;
  isHub: boolean;
  listenPort: number | null;
  externalPort: number | null;
  publicIps: string[];
  advertisedEndpoints: string[];
  appliedRevision: number | null;
  lastPushError: string | null;
}

const MACHINE = "cccccccc-3333-4333-8333-333333333333";

describe("hub ports compile into listeners", () => {
  let test: TestApp;
  let admin: LoginResult;
  let networkId = "";
  let deviceId = "";
  const hub = fakeClient();

  function headers(): Record<string, string> {
    return authed(admin, { "x-csrf-token": admin.csrfToken });
  }

  async function getDevice(): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${deviceId}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  const listenerUrls = () => hub.lastRun?.config.listenerUrls ?? [];

  beforeAll(async () => {
    test = await createTestApp();
    admin = await loginWithMockIdp(test, "admin");

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Hub lab", ipv4Cidr: "10.144.145.0/24" },
    });
    expect(network.statusCode).toBe(201);
    networkId = (network.json() as { id: string }).id;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: {},
    });
    expect(invite.statusCode).toBe(201);
    const token = (invite.json() as { token: string }).token;

    await test.context.devices.handleHeartbeat({
      token,
      machineId: MACHINE,
      hostname: "hub-node",
      easytierVersion: "2.6.4-81487c36",
      osType: "linux",
      osVersion: "6.8",
      osDistribution: "debian",
      sourceIp: "127.0.0.1",
      client: hub.client,
    });
    const list = await test.app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authed(admin),
    });
    const device = (list.json() as DeviceDto[]).find(
      (entry) => (entry as unknown as { machineId: string }).machineId === MACHINE,
    );
    if (!device) throw new Error("hub-node was not enrolled");
    deviceId = device.id;
    const approved = await test.app.inject({
      method: "POST",
      url: `/api/devices/${deviceId}/approve`,
      headers: headers(),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    await waitFor(
      () => getDevice(),
      (entry) => entry.appliedRevision === 1 && entry.lastPushError === null,
    );
  });

  afterAll(async () => {
    await test.stop();
  });

  it("stores the ports and binds them without a hand-written listener", async () => {
    const response = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${deviceId}/hub`,
      headers: headers(),
      payload: {
        isHub: true,
        listenPort: 12000,
        externalPort: 13000,
        endpoints: ["wss://hub.example.com:443"],
      },
    });
    expect(response.statusCode).toBe(200);
    const saved = response.json() as DeviceDto;
    expect(saved).toMatchObject({
      isHub: true,
      listenPort: 12000,
      externalPort: 13000,
      advertisedEndpoints: ["wss://hub.example.com:443"],
    });
    expect((await getDevice()).publicIps).toEqual([]);

    await waitFor(
      async () => listenerUrls(),
      (urls) =>
        urls.includes("tcp://0.0.0.0:12000") &&
        urls.includes("udp://0.0.0.0:12000"),
    );
    expect(listenerUrls()).not.toContain("tcp://0.0.0.0:11010");
  });

  it("falls back to the default port for a hub without ports", async () => {
    const response = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${deviceId}/hub`,
      headers: headers(),
      payload: { isHub: true, listenPort: null, externalPort: null },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as DeviceDto).listenPort).toBeNull();

    await waitFor(
      async () => listenerUrls(),
      (urls) =>
        urls.includes("tcp://0.0.0.0:11010") &&
        urls.includes("udp://0.0.0.0:11010") &&
        !urls.includes("tcp://0.0.0.0:12000"),
    );
  });

  it("rejects a port outside 1..65535", async () => {
    for (const port of [0, 65536]) {
      const response = await test.app.inject({
        method: "PUT",
        url: `/api/devices/${deviceId}/hub`,
        headers: headers(),
        payload: { isHub: true, listenPort: port },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
