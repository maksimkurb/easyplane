import { createSocket, type Socket as DgramSocket } from "node:dgram";
import { connect as netConnect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";

import WebSocket from "ws";

import { manage, web } from "@easyplane/proto";
import { protoToUuid, uuidToProto } from "@easyplane/shared";
import {
  FrameQueue,
  NOISE_MAGIC,
  NOISE_PROLOGUE,
  PEER_MANAGER_HEADER_SIZE,
  PacketType,
  RpcSession,
  SecureDatagramSession,
  WEB_CLIENT_SERVICE,
  WEB_SERVER_SERVICE,
  WebClientMethod,
  WebServerMethod,
  buildTunnelPayload,
  noiseInitiate,
  tcpFrameTransport,
  websocketFrameTransport,
  type FrameTransport,
  type TunnelLink,
} from "@easyplane/server";

/**
 * A small but real config-server client for the load/soak suite.
 *
 * It reuses the production tunnel framing, Noise handshake, secure datagram
 * layer and RPC codec, and registers the same `WebClientService` methods a real
 * easytier-core exposes. That makes a few hundred of these a faithful load:
 * every heartbeat, config push, ApplyNetworkInstance poll and route report
 * takes the same code path as a real device.
 */

export interface SimulatedClientOptions {
  /** ws:// | wss:// | tcp:// | udp:// URL (with or without the token path). */
  url: string;
  token: string;
  machineId: string;
  hostname: string;
  /** Heartbeat cadence; defaults to the real client's 1 s. */
  heartbeatIntervalMs?: number;
  /** Use the web-secure Noise tunnel (default true). */
  secure?: boolean;
}

export interface SimulatedClientStats {
  heartbeatsSent: number;
  heartbeatFailures: number;
  heartbeatLatenciesMs: number[];
  runRequests: number;
  collectRequests: number;
  applyReports: number;
  rpcErrors: number;
  connectedAt: number | null;
  closedAt: number | null;
}

function randomU32(): number {
  return randomBytes(4).readUInt32LE(0);
}

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(`invalid config-server URL: ${url}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function openWs(url: URL): Promise<FrameTransport> {
  const socket = new WebSocket(url.toString());
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    }),
    15_000,
    `websocket connect to ${url.host}`,
  );
  return websocketFrameTransport(
    socket,
    url.protocol === "wss:" ? "wss" : "ws",
    url.toString(),
    url.hostname,
  );
}

async function openTcp(url: URL): Promise<FrameTransport> {
  const port = Number(url.port || 11010);
  const socket: Socket = netConnect({ host: url.hostname, port });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    }),
    15_000,
    `tcp connect to ${url.host}`,
  );
  return tcpFrameTransport(socket, `tcp://${url.hostname}:${port}`);
}

/**
 * Client side of the EasyTier UDP session layer (SYN/SACK/DATA/FIN), mirroring
 * `UdpSessionLayer::connect` in the pinned sources.
 */
async function openUdp(url: URL): Promise<FrameTransport> {
  const port = Number(url.port || 11010);
  const socket: DgramSocket = createSocket("udp4");
  const frames = new FrameQueue();
  const connId = randomU32();
  const magic = randomBytes(8);

  await new Promise<void>((resolve) => socket.bind(0, () => resolve()));

  let socketClosed = false;
  const send = (type: number, payload: Buffer): void => {
    if (socketClosed) return;
    const datagram = Buffer.alloc(8 + payload.length);
    datagram.writeUInt32LE(connId, 0);
    datagram[4] = type;
    datagram[5] = 0;
    datagram.writeUInt16LE(payload.length, 6);
    payload.copy(datagram, 8);
    try {
      socket.send(datagram, port, url.hostname, (error) => {
        if (error && !socketClosed) frames.end(error);
      });
    } catch {
      // The socket is already closed (shutdown path).
    }
  };

  let negotiated = false;
  socket.on("message", (message) => {
    if (message.length < 8) return;
    if (message.readUInt32LE(0) !== connId) return;
    const type = message[4];
    const length = message.readUInt16LE(6);
    const payload = message.subarray(8, 8 + length);
    if (!negotiated) {
      if (type !== 2) return;
      if (!payload.subarray(0, 8).equals(magic)) return;
      negotiated = true;
      return;
    }
    if (type === 3) frames.push(payload);
    else if (type === 4) frames.end();
  });
  socket.on("error", (error) => frames.end(error));

  send(1, magic);
  const deadline = Date.now() + 5_000;
  while (!negotiated) {
    if (Date.now() > deadline) {
      socket.close();
      throw new Error("udp: no SACK from the config server");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return {
    kind: "udp",
    label: `udp://${url.hostname}:${port}#${connId}`,
    remoteAddress: url.hostname,
    frames,
    sendFrame(tunnelPayload: Buffer) {
      send(3, tunnelPayload);
    },
    close() {
      if (socketClosed) return;
      send(4, Buffer.alloc(0));
      socketClosed = true;
      try {
        socket.close();
      } catch {
        // already closed
      }
      frames.end();
    },
  };
}

async function openTransport(url: URL): Promise<FrameTransport> {
  switch (url.protocol) {
    case "ws:":
    case "wss:":
      return openWs(url);
    case "tcp:":
      return openTcp(url);
    case "udp:":
      return openUdp(url);
    default:
      throw new Error(`unsupported config-server scheme: ${url.protocol}`);
  }
}

/**
 * Wraps a transport in the production Noise handshake + secure datagram layer.
 * The real client asks GetFeature first and reconnects; the server accepts a
 * Noise msg1 on a fresh connection as well (web_security.rs), which is what
 * the simulated clients do to halve the connection count during a load test.
 */
async function secureLink(transport: FrameTransport): Promise<TunnelLink> {
  const initiator = noiseInitiate(NOISE_PROLOGUE);
  transport.sendFrame(
    buildTunnelPayload(Buffer.concat([NOISE_MAGIC, initiator.message]), {
      fromPeerId: 0,
      toPeerId: 0,
      packetType: PacketType.Data,
    }),
  );
  const response = await transport.frames.next(10_000);
  if (!response) throw new Error("noise: server closed during handshake");
  const payload = response.subarray(PEER_MANAGER_HEADER_SIZE);
  if (!payload.subarray(0, NOISE_MAGIC.length).equals(NOISE_MAGIC)) {
    throw new Error("noise: server did not answer with a Noise message");
  }
  const { rootKey } = initiator.complete(payload.subarray(NOISE_MAGIC.length));
  const session = SecureDatagramSession.initiator(rootKey);
  return {
    transportKind: transport.kind,
    label: transport.label,
    remoteAddress: transport.remoteAddress,
    secure: true,
    async nextPacket() {
      const outer = await transport.frames.next();
      if (outer === null) return null;
      return session.open(outer);
    },
    sendPacket(inner) {
      transport.sendFrame(session.seal(inner));
    },
    close() {
      transport.close();
    },
  };
}

function plainLink(transport: FrameTransport): TunnelLink {
  return {
    transportKind: transport.kind,
    label: transport.label,
    remoteAddress: transport.remoteAddress,
    secure: false,
    nextPacket: () => transport.frames.next(),
    sendPacket: (inner) => transport.sendFrame(inner),
    close: () => transport.close(),
  };
}

export class SimulatedClient {
  readonly stats: SimulatedClientStats = {
    heartbeatsSent: 0,
    heartbeatFailures: 0,
    heartbeatLatenciesMs: [],
    runRequests: 0,
    collectRequests: 0,
    applyReports: 0,
    rpcErrors: 0,
    connectedAt: null,
    closedAt: null,
  };
  readonly instances = new Map<string, manage.NetworkConfig>();

  private session: RpcSession | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private transport: FrameTransport | undefined;
  private closed = false;

  constructor(private readonly options: SimulatedClientOptions) {}

  get isClosed(): boolean {
    return this.closed;
  }

  async connect(): Promise<void> {
    const url = parseUrl(this.options.url);
    const transport = await openTransport(url);
    this.transport = transport;
    const link =
      this.options.secure === false
        ? plainLink(transport)
        : await secureLink(transport);
    const session = new RpcSession(link);
    this.session = session;
    // RpcSession is an EventEmitter; without a listener an "error" event throws
    // inside the receive loop. Real clients log and keep the session alive.
    session.on("error", () => {
      this.stats.rpcErrors += 1;
    });
    session.on("closed", () => this.onClosed());
    this.registerWebClientService(session);
    void session.run().finally(() => this.onClosed());
    this.stats.connectedAt = Date.now();
    await this.sendHeartbeat();
    const interval = this.options.heartbeatIntervalMs ?? 1_000;
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  private registerWebClientService(session: RpcSession): void {
    const register = (
      methodIndex: number,
      handler: (request: Uint8Array) => Promise<Uint8Array> | Uint8Array,
    ): void => {
      session.register(WEB_CLIENT_SERVICE, methodIndex, async (body) => handler(body));
    };

    register(WebClientMethod.ValidateConfig, (body) => {
      manage.ValidateConfigRequest.decode(body);
      return manage.ValidateConfigResponse.encode({
        tomlConfig: "# simulated client\n",
      }).finish();
    });

    register(WebClientMethod.RunNetworkInstance, (body) => {
      const request = manage.RunNetworkInstanceRequest.decode(body);
      const instId = request.instId ? protoToUuid(request.instId) : "";
      if (request.config) this.instances.set(instId, request.config);
      this.stats.runRequests += 1;
      return manage.RunNetworkInstanceResponse.encode({
        instId: request.instId,
      }).finish();
    });

    register(WebClientMethod.RetainNetworkInstance, (body) => {
      const request = manage.RetainNetworkInstanceRequest.decode(body);
      return manage.RetainNetworkInstanceResponse.encode({
        remainInstIds: request.instIds,
      }).finish();
    });

    register(WebClientMethod.CollectNetworkInfo, (body) => {
      const request = manage.CollectNetworkInfoRequest.decode(body);
      this.stats.collectRequests += 1;
      const requested =
        request.instIds.length > 0
          ? request.instIds.map((id) => protoToUuid(id))
          : [...this.instances.keys()];
      const map: Record<string, manage.NetworkInstanceRunningInfo> = {};
      for (const instanceId of requested) {
        if (!this.instances.has(instanceId)) continue;
        map[instanceId] = {
          devName: "",
          events: [],
          routes: [],
          peers: [],
          peerRoutePairs: [],
          running: true,
        };
      }
      this.stats.applyReports += 1;
      return manage.CollectNetworkInfoResponse.encode({
        info: { map },
      }).finish();
    });

    register(WebClientMethod.ListNetworkInstance, () => {
      return manage.ListNetworkInstanceResponse.encode({
        instIds: [...this.instances.keys()].map(uuidToProto),
      }).finish();
    });

    register(WebClientMethod.DeleteNetworkInstance, (body) => {
      const request = manage.DeleteNetworkInstanceRequest.decode(body);
      for (const id of request.instIds) this.instances.delete(protoToUuid(id));
      return manage.DeleteNetworkInstanceResponse.encode({
        remainInstIds: [],
      }).finish();
    });

    register(WebClientMethod.GetNetworkInstanceConfig, (body) => {
      const request = manage.GetNetworkInstanceConfigRequest.decode(body);
      const instId = request.instId ? protoToUuid(request.instId) : "";
      return manage.GetNetworkInstanceConfigResponse.encode({
        config: this.instances.get(instId),
        source: manage.ConfigSource.ConfigSourceWeb,
      }).finish();
    });

    register(WebClientMethod.ListNetworkInstanceMeta, (body) => {
      const request = manage.ListNetworkInstanceMetaRequest.decode(body);
      return manage.ListNetworkInstanceMetaResponse.encode({
        metas: request.instIds
          .map((id) => protoToUuid(id))
          .filter((id) => this.instances.has(id))
          .map((id) => ({
            instId: uuidToProto(id),
            networkName: this.instances.get(id)?.networkName ?? "",
            instanceName: "",
            configPermission: 0,
            source: manage.ConfigSource.ConfigSourceWeb,
          })),
      }).finish();
    });
  }

  private async sendHeartbeat(): Promise<void> {
    const session = this.session;
    if (!session || session.isClosed) return;
    const started = Date.now();
    try {
      await session.call({
        descriptor: {
          ...WEB_SERVER_SERVICE,
          methodIndex: WebServerMethod.Heartbeat,
        },
        payload: web.HeartbeatRequest.encode({
          machineId: uuidToProto(this.options.machineId),
          instId: uuidToProto(this.options.machineId),
          userToken: this.options.token,
          easytierVersion: "2.6.4-81487c36",
          reportTime: new Date().toISOString(),
          hostname: this.options.hostname,
          deviceOs: { osType: "linux", version: "6.8", distribution: "load" },
          runningNetworkInstances: [...this.instances.keys()].map(uuidToProto),
          supportConfigSource: true,
        }).finish(),
        timeoutMs: 5_000,
      });
      this.stats.heartbeatsSent += 1;
      this.stats.heartbeatLatenciesMs.push(Date.now() - started);
    } catch {
      this.stats.heartbeatFailures += 1;
    }
  }

  private onClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.stats.closedAt = Date.now();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.transport?.close();
  }

  close(): void {
    this.session?.close("client closed");
    this.onClosed();
  }
}

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index]!;
}
