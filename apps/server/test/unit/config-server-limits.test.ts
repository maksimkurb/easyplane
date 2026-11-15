import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { web } from "@easyplane/proto";
import { uuidToProto } from "@easyplane/shared";
import {
  ControlPlaneServer,
  RpcSession,
  WEB_SERVER_SERVICE,
  WebServerMethod,
  createSilentLogger,
  websocketFrameTransport,
} from "@easyplane/server";

const servers: ControlPlaneServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await server.stop();
});

async function startServer(
  options: Partial<ConstructorParameters<typeof ControlPlaneServer>[0]> = {},
) {
  const server = new ControlPlaneServer({
    tcpPort: null,
    wsPort: 0,
    logger: createSilentLogger(),
    ...options,
  });
  servers.push(server);
  const addresses = await server.start();
  return { server, port: addresses.wsPort! };
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/token-test`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

async function openSession(port: number): Promise<RpcSession> {
  const socket = await connect(port);
  const transport = websocketFrameTransport(
    socket,
    "ws",
    "test-client",
    "127.0.0.1",
  );
  const session = new RpcSession({
    transportKind: "ws",
    label: "test-client",
    remoteAddress: "127.0.0.1",
    secure: false,
    nextPacket: () => transport.frames.next(),
    sendPacket: (payload) => transport.sendFrame(payload),
    close: () => transport.close(),
  });
  void session.run();
  return session;
}

async function heartbeat(session: RpcSession): Promise<void> {
  await session.call({
    descriptor: {
      ...WEB_SERVER_SERVICE,
      methodIndex: WebServerMethod.Heartbeat,
    },
    payload: web.HeartbeatRequest.encode({
      machineId: uuidToProto("11111111-1111-4111-8111-111111111111"),
      instId: uuidToProto("22222222-2222-4222-8222-222222222222"),
      userToken: "token-test",
      hostname: "limits-test",
      easytierVersion: "2.6.4-81487c36",
      runningNetworkInstances: [],
    }).finish(),
    timeoutMs: 3_000,
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met before timeout");
}

describe("config-server listener hardening", () => {
  it("closes a tunnel that stops heartbeating (half-open detection)", async () => {
    const { server, port } = await startServer({ heartbeatTimeoutMs: 300 });
    const session = await openSession(port);
    await heartbeat(session);
    await waitFor(() => server.listClients().length === 1);
    const closed = new Promise<number>((resolve) => {
      session.once("closed", () => resolve(Date.now()));
    });
    const started = Date.now();
    await closed;
    expect(Date.now() - started).toBeLessThan(3_000);
    await waitFor(() => server.listClients().length === 0);
    expect(server.reapSilentClients()).toBe(0);
  });

  it("refuses connections above maxConnections", async () => {
    const { server, port } = await startServer({
      heartbeatTimeoutMs: 0,
      maxConnections: 1,
    });
    const first = await openSession(port);
    await heartbeat(first);
    await waitFor(() => server.listClients().length === 1);

    const second = await connect(port);
    const closed = new Promise<void>((resolve) => {
      second.once("close", () => resolve());
    });
    await closed;
    expect(server.listClients()).toHaveLength(1);
  });

  it("rate-limits tunnel admission per source IP", async () => {
    const { server, port } = await startServer({
      heartbeatTimeoutMs: 0,
      acceptLimitPerMinute: 1,
    });
    const first = await connect(port);
    // The second connection comes from the same IP and must be dropped even
    // before any heartbeat/authentication happens.
    const second = await connect(port);
    const closed = new Promise<void>((resolve) => {
      second.once("close", () => resolve());
    });
    await closed;
    expect(first.readyState).toBe(WebSocket.OPEN);
    expect(server.listClients()).toHaveLength(0);
  });

  it("still accepts multiple clients when under the limits", async () => {
    const { server, port } = await startServer({
      heartbeatTimeoutMs: 0,
      maxConnections: 10,
      acceptLimitPerMinute: 10,
    });
    const a = await openSession(port);
    const b = await openSession(port);
    await heartbeat(a);
    await heartbeat(b);
    await waitFor(() => server.listClients().length === 2);
    expect(server.listClients()).toHaveLength(2);
  });
});
