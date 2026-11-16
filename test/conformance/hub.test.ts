import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { instanceIdFor } from "@easyplane/server";
import type { ManagedClient } from "@easyplane/server";

import {
  M2_TUNNEL_PORTS,
  PORTS,
  openM2RelayPool,
  prepareDockerConformanceEnvironment,
  safeStringify,
  startCore,
  startM2Relay,
  stopAllCores,
  type CoreHandle,
} from "./helpers/index.js";
import {
  authed,
  bootstrapAdmin,
  createTestApp,
  type LoginResult,
  type TestApp,
} from "../support/app.js";
import type { Socket } from "node:net";

/**
 * Hub conformance against real easytier-core: one device is a hub and
 * advertises its listener endpoint; a leaf dials it. The compiler must exclude
 * the hub's own endpoint from the hub's peer list, otherwise the core dials its
 * own public address and loops with
 * "peer id conflict, are you connecting to yourself?".
 *
 * Proven here:
 *  - the hub's pushed peer_urls are empty even though it is in the network peer
 *    list with its advertised endpoint;
 *  - the leaf's peer_urls contain exactly that endpoint;
 *  - the leaf really connects to the hub;
 *  - the hub's log never contains "peer id conflict".
 */

interface DeviceDto {
  id: string;
  hostname: string;
  state: string;
  appliedRevision: number | null;
  lastPushError: string | null;
}

const MACHINES = {
  a: "aaaaaaaa-1111-4111-8111-111111111111",
  b: "bbbbbbbb-2222-4222-8222-222222222222",
} as const;
const SERVICES = { a: "core-m2-a", b: "core-m2-b" } as const;
const LISTENERS = { a: 11011, b: 11012 } as const;

async function poll<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 90_000,
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

const normalizePeers = (values: readonly string[] = []) =>
  values.map((value) => value.replace(/\/+$/, ""));

describe("hub conformance: a hub does not dial itself", () => {
  let test: TestApp;
  let admin: LoginResult;
  let networkId = "";
  const cores: Partial<Record<"a" | "b", CoreHandle>> = {};
  const devices: Partial<Record<"a" | "b", DeviceDto>> = {};
  const tunnels: Socket[] = [];

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

  async function getDevice(letter: "a" | "b"): Promise<DeviceDto> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${devices[letter]!.id}`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as DeviceDto;
  }

  function clientFor(letter: "a" | "b"): ManagedClient {
    const client = test.context.controlPlane
      .listClients()
      .find(
        (entry) => entry.latestHeartbeat?.machineId === MACHINES[letter],
      );
    if (!client) throw new Error(`no live session for ${letter}`);
    return client;
  }

  async function pushedPeers(letter: "a" | "b"): Promise<string[]> {
    const response = await clientFor(letter).remote.getNetworkInstanceConfig(
      instanceIdFor(networkId, devices[letter]!.id),
    );
    return normalizePeers(response.config?.peerUrls ?? []);
  }

  beforeAll(async () => {
    prepareDockerConformanceEnvironment();
    test = await createTestApp({
      oidc: false,
      env: {
        EASYPLANE_HOST: "0.0.0.0",
        EASYPLANE_WS_PORT: String(PORTS.hub),
        EASYPLANE_TCP_PORT: "0",
        EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "5000",
        EASYPLANE_RECONCILE_INTERVAL_MS: "1000",
        EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "1000",
      },
    });
    await test.context.controlPlane.start();
    test.context.push.start(1000);
    admin = await bootstrapAdmin(test);
  });

  afterAll(async () => {
    for (const socket of tunnels) socket.destroy();
    stopAllCores();
    await test?.context.push.stop();
    await test?.context.controlPlane.stop();
    await test?.stop();
  });

  it("enrols a hub and a leaf, then compiles the hub out of its own list", async () => {
    const created = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Hub Conformance", ipv4Cidr: "10.89.0.0/24" },
    });
    expect(created.statusCode).toBe(201);
    networkId = (created.json() as { id: string }).id;

    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { maxUses: null, expiresInHours: null },
    });
    expect(invite.statusCode).toBe(201);
    const inviteToken = (invite.json() as { token: string }).token;

    startM2Relay();
    for (const letter of ["a", "b"] as const) {
      tunnels.push(...(await openM2RelayPool(letter, PORTS.hub)));
    }
    for (const letter of ["a", "b"] as const) {
      cores[letter] = startCore(
        SERVICES[letter],
        `ws://m2-relay:${M2_TUNNEL_PORTS[letter]}/${encodeURIComponent(inviteToken)}`,
      );
    }

    await poll(
      "two client sessions",
      async () => test.context.controlPlane.listClients().length,
      (count) => count >= 2,
      120_000,
    );
    const pending = await poll(
      "two pending devices",
      getDevices,
      (list) => list.length >= 2,
    );
    for (const letter of ["a", "b"] as const) {
      const device = pending.find((entry) => entry.hostname === `core-${letter}`);
      if (!device) throw new Error(`device core-${letter} not enrolled`);
      const approved = await test.app.inject({
        method: "POST",
        url: `/api/devices/${device.id}/approve`,
        headers: headers(),
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      devices[letter] = approved.json() as DeviceDto;
    }

    // A is the hub and advertises the service name it listens on; the same URL
    // used to be broadcast back to A, which made it dial itself forever.
    const endpoint = `tcp://core-m2-a:${LISTENERS.a}`;
    const endpoints = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(),
      payload: { endpoints: [endpoint] },
    });
    expect(endpoints.statusCode).toBe(200);
    const hub = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/hub`,
      headers: headers(),
      payload: { isHub: true },
    });
    expect(hub.statusCode).toBe(200);

    for (const letter of ["a", "b"] as const) {
      const response = await test.app.inject({
        method: "POST",
        url: `/api/devices/${devices[letter]!.id}/revisions`,
        headers: headers(),
        payload: {
          config: {
            listenerUrls: [`tcp://0.0.0.0:${LISTENERS[letter]}`],
          },
          note: "hub conformance",
        },
      });
      expect(response.statusCode).toBe(201);
    }
    for (const letter of ["a", "b"] as const) {
      await poll(
        `${letter} applied revision 2`,
        () => getDevice(letter),
        (device) => device.appliedRevision === 2 && device.lastPushError === null,
      );
    }

    // The core's own reported config is the source of truth here.
    expect(await pushedPeers("a")).toEqual([]);
    expect(await pushedPeers("b")).toEqual([endpoint]);
  });

  it("connects the leaf to the hub and never logs a self-dial on the hub", async () => {
    await poll(
      "hub sees the leaf as a peer",
      async () => {
        const info = await clientFor("a").remote.collectNetworkInfo([
          instanceIdFor(networkId, devices.a!.id),
        ]);
        const running = info.info?.map[instanceIdFor(networkId, devices.a!.id)];
        return running?.peers?.length ?? 0;
      },
      (peers) => peers >= 1,
      90_000,
    );

    // Give a self-dial loop time to show up; the core logs the conflict
    // message as soon as it connects to its own peer id.
    const deadline = Date.now() + 15_000;
    let hubLogs = "";
    while (Date.now() < deadline) {
      hubLogs = cores.a!.logs();
      if (hubLogs.includes("peer id conflict")) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(hubLogs).not.toContain("peer id conflict");
    // The hub is up and listening rather than isolated by the guard.
    expect(hubLogs).not.toContain("are you connecting to yourself");
  });
});
