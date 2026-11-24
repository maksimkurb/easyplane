import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";
import { manage } from "@easyplane/proto";

import { openSseStream, type SseStream } from "../support/sse.js";
import {
  authed,
  createTestApp,
  loginWithMockIdp,
  sessionCookie,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

interface FakeRunRequest {
  instId: string;
  config: manage.NetworkConfig;
}

function fakeClient(id: string) {
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
    id,
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
  hostname: string;
  isHub: boolean;
  advertisedEndpoints: string[];
  appliedRevision: number | null;
  lastPushError: string | null;
}

interface PeerDto {
  id: string;
  kind: "device" | "external";
  url: string | null;
  deviceId: string | null;
  deviceIsHub: boolean;
  endpoints: string[];
  suggestedDeviceId: string | null;
}

const MACHINES = {
  a: "aaaaaaaa-1111-4111-8111-111111111111",
  b: "bbbbbbbb-2222-4222-8222-222222222222",
} as const;

describe("network peers: hub endpoints, raw URLs, roles and repushes", () => {
  let test: TestApp;
  let admin: LoginResult;
  let member: LoginResult;
  let viewer: LoginResult;
  let baseUrl = "";
  let networkId = "";
  let inviteToken = "";
  let stream: SseStream | null = null;
  const clients = { a: fakeClient("session-a"), b: fakeClient("session-b") };
  const devices: Partial<Record<"a" | "b", DeviceDto>> = {};

  function headers(login: LoginResult = admin): Record<string, string> {
    return authed(login, { "x-csrf-token": login.csrfToken });
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

  async function getPeers(): Promise<PeerDto[]> {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/peers`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { peers: PeerDto[] }).peers;
  }

  const peerUrls = (letter: "a" | "b") =>
    clients[letter].lastRun?.config.peerUrls ?? [];

  beforeAll(async () => {
    test = await createTestApp();
    await test.app.listen({ host: "127.0.0.1", port: 0 });
    const address = test.app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server has no port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    admin = await loginWithMockIdp(test, "admin");
    member = await loginWithMockIdp(test, "member");
    viewer = await loginWithMockIdp(test, "viewer");

    const network = await test.app.inject({
      method: "POST",
      url: "/api/networks",
      headers: headers(),
      payload: { name: "Peer lab", ipv4Cidr: "10.144.144.0/24" },
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
    inviteToken = (invite.json() as { token: string }).token;

    for (const letter of ["a", "b"] as const) {
      await test.context.devices.handleHeartbeat({
        token: inviteToken,
        machineId: MACHINES[letter],
        hostname: `node-${letter}`,
        easytierVersion: "2.6.4-81487c36",
        osType: "linux",
        osVersion: "6.8",
        osDistribution: "debian",
        sourceIp: "127.0.0.1",
        client: clients[letter].client,
      });
      const list = await test.app.inject({
        method: "GET",
        url: "/api/devices",
        headers: authed(admin),
      });
      const device = (list.json() as DeviceDto[]).find(
        (entry) => entry.hostname === `node-${letter}`,
      );
      if (!device) throw new Error(`device node-${letter} not enrolled`);
      const approved = await test.app.inject({
        method: "POST",
        url: `/api/devices/${device.id}/approve`,
        headers: headers(),
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      devices[letter] = approved.json() as DeviceDto;
    }
    for (const letter of ["a", "b"] as const) {
      await waitFor(
        () => getDevice(letter),
        (device) => device.appliedRevision === 1 && device.lastPushError === null,
      );
    }
  });

  afterAll(async () => {
    stream?.close();
    await test.stop();
  });

  it("gives the hub an empty list and the leaf the hub endpoint", async () => {
    const endpoints = ["tcp://node-a.example.com:11010"];
    const updated = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(),
      payload: { endpoints },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as DeviceDto).advertisedEndpoints).toEqual(endpoints);

    const hub = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/hub`,
      headers: headers(),
      payload: { isHub: true },
    });
    expect(hub.statusCode).toBe(200);
    expect((hub.json() as DeviceDto).isHub).toBe(true);

    await waitFor(
      async () => peerUrls("a").join(","),
      (value) => value === "",
    );
    await waitFor(
      async () => peerUrls("b").join(","),
      (value) => value === endpoints[0],
    );
    expect(peerUrls("a")).toEqual([]);
    expect(peerUrls("b")).toEqual(endpoints);

    const peers = await getPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({
      kind: "device",
      deviceId: devices.a!.id,
      deviceIsHub: true,
      endpoints,
    });
  });

  it("pushes a raw URL to everyone and can convert it into a device entry", async () => {
    const url = "tcp://node-b.example.com:11010";
    const created = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/peers`,
      headers: headers(),
      payload: { url },
    });
    expect(created.statusCode).toBe(201);
    const raw = created.json() as PeerDto;
    expect(raw).toMatchObject({ kind: "external", url, suggestedDeviceId: null });

    // The raw URL reaches the hub and the leaf (it is not tied to a device).
    for (const letter of ["a", "b"] as const) {
      await waitFor(
        async () => peerUrls(letter).join(","),
        (value) => value.includes(url),
      );
    }

    // Give B the same endpoint, then link the raw entry to B: it becomes
    // device-backed, B becomes a hub and stops receiving its own URL while A
    // keeps dialling it.
    const endpoints = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.b!.id}/endpoints`,
      headers: headers(),
      payload: { endpoints: [url] },
    });
    expect(endpoints.statusCode).toBe(200);

    const linked = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/peers/${raw.id}/link`,
      headers: headers(),
      payload: { deviceId: devices.b!.id },
    });
    expect(linked.statusCode).toBe(200);
    const linkedPeer = linked.json() as PeerDto;
    expect(linkedPeer).toMatchObject({
      kind: "device",
      deviceId: devices.b!.id,
      url: null,
      deviceIsHub: true,
    });
    await waitFor(
      async () => (await getDevice("b")).isHub,
      (value) => value === true,
    );
    await waitFor(
      async () => peerUrls("b").join(","),
      (value) => !value.includes(url),
    );
    await waitFor(
      async () => peerUrls("a").join(","),
      (value) => value.includes(url),
    );
    // A is a hub itself, so it only dials B; B dials only A.
    expect(peerUrls("a")).toEqual([url]);
    expect(peerUrls("b")).toEqual(["tcp://node-a.example.com:11010"]);

    // Deleting the device-backed entry clears B's hub flag.
    const removed = await test.app.inject({
      method: "DELETE",
      url: `/api/networks/${networkId}/peers/${linkedPeer.id}`,
      headers: headers(),
    });
    expect(removed.statusCode).toBe(200);
    await waitFor(
      async () => (await getDevice("b")).isHub,
      (value) => value === false,
    );
    await waitFor(
      async () => peerUrls("a").join(","),
      (value) => value === "",
    );
  });

  it("enforces roles: endpoints are member-writable, peers and hubs are admin-only", async () => {
    const endpointPayload = { endpoints: ["tcp://node-a.example.com:11010"] };
    const asMember = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(member),
      payload: endpointPayload,
    });
    expect(asMember.statusCode).toBe(200);

    const memberPeer = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/peers`,
      headers: headers(member),
      payload: { url: "tcp://member.example.com:11010" },
    });
    expect(memberPeer.statusCode).toBe(403);

    const memberHub = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/hub`,
      headers: headers(member),
      payload: { isHub: true },
    });
    expect(memberHub.statusCode).toBe(403);

    const viewerEndpoints = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(viewer),
      payload: endpointPayload,
    });
    expect(viewerEndpoints.statusCode).toBe(403);

    const viewerRead = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/peers`,
      headers: authed(viewer),
    });
    expect(viewerRead.statusCode).toBe(200);
  });

  it("repushes on a hub endpoint change, records a settings revision on the hub only, audited and over SSE", async () => {
    stream = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(admin),
    });
    const revisionCount = async (letter: "a" | "b") =>
      (
        (
          await test.app.inject({
            method: "GET",
            url: `/api/devices/${devices[letter]!.id}/revisions`,
            headers: authed(admin),
          })
        ).json() as unknown[]
      ).length;
    const hubBefore = await revisionCount("a");
    const peerBefore = await revisionCount("b");
    const changedUrl = "tcp://node-a.example.com:11011";
    const changed = await test.app.inject({
      method: "PUT",
      url: `/api/devices/${devices.a!.id}/endpoints`,
      headers: headers(),
      payload: { endpoints: [changedUrl] },
    });
    expect(changed.statusCode).toBe(200);

    await waitFor(
      async () => peerUrls("b").join(","),
      (value) => value.includes(changedUrl),
    );
    const frame = await stream.waitFor(
      (event) =>
        event.type === "network.updated" &&
        event.data.reason === "peer-endpoints-updated",
      10_000,
    );
    expect(frame.data.networkId).toBe(networkId);

    // The hub's own settings change is a history entry; peers resolving the new
    // address is network state and creates no revision for them.
    expect(await revisionCount("a")).toBe(hubBefore + 1);
    expect(await revisionCount("b")).toBe(peerBefore);

    const audit = await test.app.inject({
      method: "GET",
      url: "/api/audit?limit=100",
      headers: authed(admin),
    });
    const actions = (audit.json() as Array<{ action: string }>).map(
      (entry) => entry.action,
    );
    expect(actions).toContain("device.endpoints_updated");
    expect(actions).toContain("device.hub_enabled");
    expect(actions).toContain("network.peer_added");
    expect(actions).toContain("network.peer_linked");
    expect(actions).toContain("network.peer_removed");
  });
});
