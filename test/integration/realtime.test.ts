import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ManagedClient } from "@easyplane/server";

import { openSseStream } from "../support/sse.js";
import {
  authed,
  createTestApp,
  loginWithMockIdp,
  sessionCookie,
  type LoginResult,
  type TestApp,
} from "../support/app.js";

/**
 * Realtime over a real HTTP listener: SSE authentication, role checks, the
 * per-user connection cap, Last-Event-ID replay and the actual service event
 * wiring (network + device changes), plus the topology read API for a network
 * with no online devices.
 *
 * The stream endpoint is hijacked by Fastify, so `app.inject` cannot consume
 * it; these tests listen on an ephemeral port and use fetch, exactly like a
 * browser would.
 */

interface DeviceDto {
  id: string;
  state: string;
  online: string;
}

function fakeClient(id = "session-1"): ManagedClient {
  const state = { closed: false };
  return {
    id,
    get isClosed() {
      return state.closed;
    },
    close: () => {
      state.closed = true;
    },
    heartbeatCount: 1,
    transportKind: "ws",
    secure: true,
    remoteAddress: "127.0.0.1",
    latestHeartbeat: undefined,
    remote: {},
  } as unknown as ManagedClient;
}

async function poll<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met; last=${JSON.stringify(last)}`);
}

describe("realtime events and topology API", () => {
  let test: TestApp;
  let admin: LoginResult;
  let viewer: LoginResult;
  let baseUrl = "";
  let networkId = "";

  function headers(extra: Record<string, string> = {}) {
    return authed(admin, { "x-csrf-token": admin.csrfToken, ...extra });
  }

  beforeAll(async () => {
    test = await createTestApp({
      env: {
        EASYPLANE_SSE_MAX_PER_USER: "1",
        EASYPLANE_TOPOLOGY_IDLE_INTERVAL_MS: "60000",
        EASYPLANE_TOPOLOGY_ACTIVE_INTERVAL_MS: "1000",
      },
    });
    admin = await loginWithMockIdp(test, "admin");
    viewer = await loginWithMockIdp(test, "viewer");
    await test.app.listen({ host: "127.0.0.1", port: 0 });
    const address = test.app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("listener has no port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await test?.stop();
  });

  // Stream teardown is asynchronous (the server sees the socket close on a
  // later tick), so let the hub release the per-user slot between tests.
  afterEach(async () => {
    await poll(async () => test.context.realtime.size, (count) => count === 0).catch(
      () => undefined,
    );
  });

  it("refuses an unauthenticated stream", async () => {
    const stream = await openSseStream(`${baseUrl}/api/events`);
    expect(stream.status).toBe(401);
    stream.close();
  });

  it("streams service events to a viewer and enforces roles on mutations", async () => {
    const stream = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(viewer),
    });
    expect(stream.status).toBe(200);
    try {
      const hello = await stream.waitFor((frame) => frame.type === "hello", 5_000);
      expect(hello.data.user).toMatchObject({ role: "viewer" });
      expect(hello.id).toBe(0);

      // A viewer may not create a network...
      const forbidden = await test.app.inject({
        method: "POST",
        url: "/api/networks",
        headers: authed(viewer, { "x-csrf-token": viewer.csrfToken }),
        payload: { name: "Nope" },
      });
      expect(forbidden.statusCode).toBe(403);

      // ...but the admin's creation reaches the viewer's stream.
      const created = await test.app.inject({
        method: "POST",
        url: "/api/networks",
        headers: headers(),
        payload: { name: "Realtime", ipv4Cidr: "10.90.0.0/24" },
      });
      expect(created.statusCode).toBe(201);
      networkId = (created.json() as { id: string }).id;
      const event = await stream.waitFor(
        (frame) =>
          frame.type === "network.updated" &&
          frame.data.networkId === networkId,
        5_000,
      );
      expect(event.id).toBeGreaterThan(0);
      expect(event.data.reason).toBe("created");
      // The event is a cache hint, not a data channel.
      expect(JSON.stringify(event.data)).not.toContain("secret");
    } finally {
      stream.close();
    }
  });

  it("replays buffered events for Last-Event-ID and asks for a resync otherwise", async () => {
    // Produce two events and remember the first id.
    for (const name of ["Replay A", "Replay B"]) {
      const response = await test.app.inject({
        method: "POST",
        url: "/api/networks",
        headers: headers(),
        payload: { name },
      });
      expect(response.statusCode).toBe(201);
    }
    const last = test.context.realtime.lastSequence;
    expect(last).toBeGreaterThan(1);

    const replay = await openSseStream(
      `${baseUrl}/api/events?lastEventId=${last - 1}`,
      { cookie: sessionCookie(admin) }
    );
    expect(replay.status).toBe(200);
    try {
      const replayed = await replay.waitFor(
        (frame) => frame.type === "network.updated" && frame.id === last,
        5_000,
      );
      expect(replayed.id).toBe(last);
    } finally {
      replay.close();
    }

    // An id from before the buffer (or another process) cannot be replayed.
    const resync = await openSseStream(
      `${baseUrl}/api/events?lastEventId=999999`,
      { cookie: sessionCookie(admin) }
    );
    try {
      await resync.waitFor((frame) => frame.type === "resync", 5_000);
    } finally {
      resync.close();
    }
  });

  it("bounds streams per user", async () => {
    const first = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(admin),
    });
    expect(first.status).toBe(200);
    // The cap is 1 in this run.
    const second = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(admin),
    });
    expect(second.status).toBe(429);
    first.close();
    second.close();
    await poll(
      async () => test.context.realtime.connectionsForUser(admin.userId),
      (count) => count === 0
    );
  });

  it("publishes device.updated for join and approval", async () => {
    const invite = await test.app.inject({
      method: "POST",
      url: `/api/networks/${networkId}/invites`,
      headers: headers(),
      payload: { maxUses: 1, expiresInHours: 1 },
    });
    expect(invite.statusCode).toBe(201);
    const token = (invite.json() as { token: string }).token;

    const stream = await openSseStream(`${baseUrl}/api/events`, {
      cookie: sessionCookie(admin),
    });
    try {
      const client = fakeClient();
      await test.context.devices.handleHeartbeat({
        token,
        machineId: "dddddddd-4444-4444-8444-444444444444",
        hostname: "node-realtime",
        easytierVersion: "2.6.4-81487c36",
        osType: "linux",
        osVersion: "6.8",
        osDistribution: "debian",
        sourceIp: "127.0.0.1",
        client,
      });

      const joined = await stream.waitFor(
        (frame) =>
          frame.type === "device.updated" &&
          frame.data.hostname === "node-realtime",
        5_000,
      );
      expect(joined.data.state).toBe("pending");
      expect(joined.data.reason).toBe("joined");
      const deviceId = joined.data.deviceId as string;

      const approved = await test.app.inject({
        method: "POST",
        url: `/api/devices/${deviceId}/approve`,
        headers: headers(),
        payload: {},
      });
      expect(approved.statusCode).toBe(200);
      const device = approved.json() as DeviceDto;
      expect(device.state).toBe("approved");

      const approval = await stream.waitFor(
        (frame) =>
          frame.type === "device.updated" &&
          frame.data.deviceId === deviceId &&
          frame.data.state === "approved",
        5_000,
      );
      expect(approval.data.reason).toBe("approved");
      expect(approval.data.virtualIpv4).toBeTruthy();
    } finally {
      stream.close();
    }
  });

  it("serves a topology snapshot to any role", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: `/api/networks/${networkId}/topology?refresh=1`,
      headers: authed(viewer),
    });
    expect(response.statusCode).toBe(200);
    const snapshot = response.json() as {
      networkId: string;
      partial: boolean;
      nodes: Array<{ deviceId: string | null; online: boolean }>;
      links: unknown[];
      stats: { nodes: number; links: number; failedObservations: number };
      collectedAt: string;
    };
    expect(snapshot.networkId).toBe(networkId);
    // The approved device from the previous test is in the map even though its
    // session cannot be probed here (the fake client has no CollectNetworkInfo).
    const node = snapshot.nodes.find((entry) => entry.deviceId);
    expect(node?.online).toBe(false);
    expect(snapshot.stats.failedObservations).toBeGreaterThanOrEqual(1);
    expect(snapshot.partial).toBe(true);
    expect(Date.parse(snapshot.collectedAt)).not.toBeNaN();
  });

  it("hides topology of a network that does not exist", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/api/networks/00000000-0000-4000-8000-000000000000/topology",
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(404);
  });

  it("serves per-device raw topology for the drawer", async () => {
    const devices = await test.app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authed(admin),
    });
    const list = devices.json() as DeviceDto[];
    const device = list.find((entry) => entry.state === "approved")!;
    const response = await test.app.inject({
      method: "GET",
      url: `/api/devices/${device.id}/topology?refresh=1`,
      headers: authed(admin),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      deviceId: string;
      node: { id: string } | null;
      observation: { deviceId: string } | null;
      links: unknown[];
    };
    expect(body.deviceId).toBe(device.id);
    expect(body.node?.id).toBeTruthy();
    expect(body.observation?.deviceId).toBe(device.id);
  });
});
