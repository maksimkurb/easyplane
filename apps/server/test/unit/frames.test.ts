import { EventEmitter } from "node:events";
import type { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { FrameQueue, tcpFrameTransport } from "@easyplane/server";

class FakeSocket extends EventEmitter {
  readonly written: Buffer[] = [];
  destroyed = false;
  setNoDelay(): this {
    return this;
  }
  write(chunk: Buffer): boolean {
    this.written.push(Buffer.from(chunk));
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function asSocket(socket: FakeSocket): Socket {
  return socket as unknown as Socket;
}

describe("TCP tunnel framing (framed.rs)", () => {
  it("extracts u32-le length-prefixed frames from arbitrary chunk boundaries", async () => {
    const socket = new FakeSocket();
    const transport = tcpFrameTransport(asSocket(socket), "test");

    const payload = Buffer.concat([Buffer.alloc(16, 1), Buffer.from("payload")]);
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);

    // Split across boundaries, including inside the length prefix.
    socket.emit("data", frame.subarray(0, 2));
    socket.emit("data", frame.subarray(2, 7));
    socket.emit("data", frame.subarray(7));

    const decoded = await transport.frames.next(1000);
    expect(decoded?.equals(payload)).toBe(true);
  });

  it("writes the same length-prefixed framing on send", () => {
    const socket = new FakeSocket();
    const transport = tcpFrameTransport(asSocket(socket), "test");
    const payload = Buffer.concat([Buffer.alloc(16, 2), Buffer.from("out")]);
    transport.sendFrame(payload);
    expect(socket.written).toHaveLength(1);
    const written = socket.written[0]!;
    expect(written.readUInt32LE(0)).toBe(payload.length);
    expect(written.subarray(4).equals(payload)).toBe(true);
  });

  it("rejects bodies shorter than the peer-manager header", async () => {
    const socket = new FakeSocket();
    const transport = tcpFrameTransport(asSocket(socket), "test");
    const frame = Buffer.alloc(4);
    frame.writeUInt32LE(4, 0);
    socket.emit("data", frame);
    await expect(transport.frames.next(1000)).rejects.toThrow(/below peer-manager header/);
  });

  it("rejects absurdly large bodies", async () => {
    const socket = new FakeSocket();
    const transport = tcpFrameTransport(asSocket(socket), "test");
    const frame = Buffer.alloc(4);
    frame.writeUInt32LE(70 * 1024, 0);
    socket.emit("data", frame);
    await expect(transport.frames.next(1000)).rejects.toThrow(/exceeds limit/);
  });
});

describe("FrameQueue", () => {
  it("times out without losing the queue", async () => {
    const queue = new FrameQueue();
    await expect(queue.next(10)).rejects.toThrow(/timeout/);
    queue.push(Buffer.from("late"));
    expect((await queue.next(100))?.toString()).toBe("late");
  });
});
