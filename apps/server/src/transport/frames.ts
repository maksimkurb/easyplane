import type { Socket } from "node:net";
import { WebSocket } from "ws";

import {
  MAX_INBOUND_FRAME_BYTES,
  PEER_MANAGER_HEADER_SIZE,
  TCP_TUNNEL_HEADER_SIZE,
} from "../protocol/constants.js";

export type TransportKind = "tcp" | "ws" | "wss";

interface Waiter {
  resolve: (value: Buffer | null) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * Ordered queue of inbound tunnel payloads. `null` means the transport is
 * closed, which the session loop treats as a clean end of stream.
 */
export class FrameQueue {
  private readonly queued: Buffer[] = [];
  private readonly waiters: Waiter[] = [];
  private ended = false;
  private failure: Error | undefined;

  push(frame: Buffer): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }
    this.queued.push(frame);
  }

  end(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer) clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve(null);
    }
  }

  /** Next frame, or `null` on close. Rejects on timeout if a timeout is given. */
  next(timeoutMs?: number): Promise<Buffer | null> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    if (this.ended) {
      return this.failure ? Promise.reject(this.failure) : Promise.resolve(null);
    }
    return new Promise<Buffer | null>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("frame timeout"));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  get isEnded(): boolean {
    return this.ended;
  }
}

export interface FrameTransport {
  readonly kind: TransportKind;
  readonly label: string;
  /** Peer address (no port), used for rate limiting by source IP. */
  readonly remoteAddress: string;
  readonly frames: FrameQueue;
  sendFrame(tunnelPayload: Buffer): void;
  close(): void;
}

class TcpFrameTransport implements FrameTransport {
  readonly kind = "tcp" as const;
  readonly remoteAddress: string;
  readonly frames = new FrameQueue();
  private pending: Buffer = Buffer.alloc(0);

  constructor(
    private readonly socket: Socket,
    readonly label: string,
  ) {
    this.remoteAddress = socket.remoteAddress ?? "";
    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (error) => this.frames.end(error));
    socket.on("close", () => this.frames.end());
  }

  private onData(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    for (;;) {
      if (this.pending.length < TCP_TUNNEL_HEADER_SIZE) return;
      const bodyLen = this.pending.readUInt32LE(0);
      if (bodyLen < PEER_MANAGER_HEADER_SIZE) {
        this.frames.end(new Error(`tcp framing: body length ${bodyLen} below peer-manager header`));
        this.close();
        return;
      }
      if (bodyLen > MAX_INBOUND_FRAME_BYTES) {
        this.frames.end(new Error(`tcp framing: body length ${bodyLen} exceeds limit`));
        this.close();
        return;
      }
      const total = TCP_TUNNEL_HEADER_SIZE + bodyLen;
      if (this.pending.length < total) return;
      const frame = this.pending.subarray(TCP_TUNNEL_HEADER_SIZE, total);
      this.pending = this.pending.subarray(total);
      this.frames.push(frame);
    }
  }

  sendFrame(tunnelPayload: Buffer): void {
    const header = Buffer.allocUnsafe(TCP_TUNNEL_HEADER_SIZE);
    header.writeUInt32LE(tunnelPayload.length, 0);
    this.socket.write(Buffer.concat([header, tunnelPayload]));
  }

  close(): void {
    this.socket.destroy();
  }
}

class WebSocketFrameTransport implements FrameTransport {
  readonly frames = new FrameQueue();

  constructor(
    private readonly ws: WebSocket,
    readonly kind: TransportKind,
    readonly label: string,
    readonly remoteAddress: string,
  ) {
    ws.on("message", (data, isBinary) => {
      // tokio-websockets delivers binary messages only; text is a protocol error.
      if (!isBinary) {
        this.frames.end(new Error("websocket: received non-binary message"));
        this.close();
        return;
      }
      const payload = Array.isArray(data)
        ? Buffer.concat(data as Buffer[])
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
      this.frames.push(payload);
    });
    ws.on("error", (error: Error) => this.frames.end(error));
    ws.on("close", () => this.frames.end());
  }

  sendFrame(tunnelPayload: Buffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(tunnelPayload, { binary: true });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore: socket already gone
    }
  }
}

export function tcpFrameTransport(socket: Socket, label: string): FrameTransport {
  return new TcpFrameTransport(socket, label);
}

export function websocketFrameTransport(
  ws: WebSocket,
  kind: TransportKind,
  label: string,
  remoteAddress = "",
): FrameTransport {
  return new WebSocketFrameTransport(ws, kind, label, remoteAddress);
}
