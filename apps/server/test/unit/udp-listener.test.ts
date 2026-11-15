import { createSocket, type Socket as DgramSocket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";

import {
  UdpConfigServerListener,
  UDP_TUNNEL_HEADER_SIZE,
  UdpPacketType,
  createSilentLogger,
  type FrameTransport,
} from "@easyplane/server";

const listeners: UdpConfigServerListener[] = [];
const sockets: DgramSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const listener of listeners.splice(0)) await listener.stop();
});

function header(connId: number, type: UdpPacketType, payload: Buffer): Buffer {
  const result = Buffer.alloc(UDP_TUNNEL_HEADER_SIZE + payload.length);
  result.writeUInt32LE(connId >>> 0, 0);
  result[4] = type;
  result[5] = 0;
  result.writeUInt16LE(payload.length, 6);
  payload.copy(result, UDP_TUNNEL_HEADER_SIZE);
  return result;
}

async function startListener(maxSessions?: number) {
  const transports: FrameTransport[] = [];
  const listener = new UdpConfigServerListener({
    host: "127.0.0.1",
    port: 0,
    logger: createSilentLogger(),
    ...(maxSessions !== undefined ? { maxSessions } : {}),
    onTransport: (transport) => transports.push(transport),
  });
  listeners.push(listener);
  const port = await listener.start();
  return { listener, port, transports };
}

async function client() {
  const socket = createSocket("udp4");
  sockets.push(socket);
  await new Promise<void>((resolve) =>
    socket.bind(0, "127.0.0.1", () => resolve()),
  );
  const inbox: Buffer[] = [];
  const waiters: Array<(value: Buffer) => void> = [];
  socket.on("message", (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else inbox.push(message);
  });
  return {
    socket,
    send(buffer: Buffer, port: number): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        socket.send(buffer, port, "127.0.0.1", (error) =>
          error ? reject(error) : resolve(),
        );
      });
    },
    next(timeoutMs = 2_000): Promise<Buffer> {
      const queued = inbox.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timeout waiting for datagram")),
          timeoutMs,
        );
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    },
  };
}

describe("UDP config-server listener", () => {
  it("completes SYN/SACK and delivers DATA frames", async () => {
    const { listener, port, transports } = await startListener();
    const peer = await client();
    const connId = 0xdeadbeef;
    const magic = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

    await peer.send(header(connId, UdpPacketType.Syn, magic), port);
    const sack = await peer.next();
    expect(sack.readUInt32LE(0)).toBe(connId);
    expect(sack[4]).toBe(UdpPacketType.Sack);
    expect(sack.readUInt16LE(6)).toBe(8);
    expect(sack.subarray(UDP_TUNNEL_HEADER_SIZE)).toEqual(magic);
    expect(listener.sessionCount).toBe(1);
    expect(transports).toHaveLength(1);

    // A retransmitted SYN gets another SACK without a second session.
    await peer.send(header(connId, UdpPacketType.Syn, magic), port);
    const sackAgain = await peer.next();
    expect(sackAgain[4]).toBe(UdpPacketType.Sack);
    expect(listener.sessionCount).toBe(1);
    expect(transports).toHaveLength(1);

    const transport = transports[0]!;
    // The tunnel payload is opaque here: in production it is the 16-byte
    // peer-manager header + RPC bytes.
    const tunnelPayload = Buffer.concat([
      Buffer.alloc(16, 0),
      Buffer.from("hello-rpc"),
    ]);
    await peer.send(header(connId, UdpPacketType.Data, tunnelPayload), port);
    expect(await transport.frames.next(2_000)).toEqual(tunnelPayload);

    // Server -> client DATA keeps the conn id and the payload as is.
    transport.sendFrame(
      Buffer.concat([Buffer.alloc(16, 7), Buffer.from("pong")]),
    );
    const outbound = await peer.next();
    expect(outbound.readUInt32LE(0)).toBe(connId);
    expect(outbound[4]).toBe(UdpPacketType.Data);
    expect(outbound.readUInt16LE(6)).toBe(20);
    expect(outbound.subarray(UDP_TUNNEL_HEADER_SIZE)).toEqual(
      Buffer.concat([Buffer.alloc(16, 7), Buffer.from("pong")]),
    );

    // FIN closes the framed transport.
    await peer.send(header(connId, UdpPacketType.Fin, Buffer.alloc(0)), port);
    expect(await transport.frames.next(2_000)).toBeNull();
    expect(listener.sessionCount).toBe(0);
  });

  it("ignores datagrams with a wrong declared length and DATA without a session", async () => {
    const { listener, port, transports } = await startListener();
    const peer = await client();

    const bad = header(7, UdpPacketType.Data, Buffer.alloc(4));
    bad.writeUInt16LE(99, 6);
    await peer.send(bad, port);
    // DATA without a session gets a FIN and allocates nothing.
    await peer.send(
      header(9, UdpPacketType.Data, Buffer.alloc(16)),
      port,
    );
    const fin = await peer.next();
    expect(fin[4]).toBe(UdpPacketType.Fin);
    expect(listener.sessionCount).toBe(0);
    expect(transports).toHaveLength(0);
  });

  it("rejects SYN above the session cap", async () => {
    const { listener, port, transports } = await startListener(1);
    const first = await client();
    const second = await client();

    await first.send(header(1, UdpPacketType.Syn, Buffer.alloc(8)), port);
    expect((await first.next())[4]).toBe(UdpPacketType.Sack);

    await second.send(header(2, UdpPacketType.Syn, Buffer.alloc(8)), port);
    const fin = await second.next();
    expect(fin[4]).toBe(UdpPacketType.Fin);
    expect(listener.sessionCount).toBe(1);
    expect(transports).toHaveLength(1);
  });
});
