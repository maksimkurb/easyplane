import { createSocket, type RemoteInfo, type Socket as DgramSocket } from "node:dgram";

import { MAX_INBOUND_FRAME_BYTES, PEER_MANAGER_HEADER_SIZE } from "../protocol/constants.js";
import type { Logger } from "../logger.js";
import { FrameQueue, type FrameTransport } from "../transport/frames.js";

/**
 * EasyTier UDP config-server transport.
 *
 * Sources (pinned commit 81487c363a5677…):
 * - `easytier-core/src/packet/mod.rs` (`UDPTunnelHeader`, `UdpPacketType`)
 * - `easytier-core/src/socket/udp/{packet,layer,session}.rs`
 * - `easytier-core/src/connectivity/transport/udp.rs` (client dial)
 *
 * Datagram layout (all little-endian, `DefaultEndian = LittleEndian`):
 *
 *   +--------+--------+---------+--------+-----------------------------+
 *   | conn_id| msg    | padding | len    | payload (`len` bytes)        |
 *   | u32    | u8     | u8      | u16    |                             |
 *   +--------+--------+---------+--------+-----------------------------+
 *
 * Handshake:
 *  1. client -> server: `SYN` (msg 1) with an 8-byte random `magic`
 *  2. server -> client: `SACK` (msg 2) echoing the same conn_id and magic
 *  3. both sides send `DATA` (msg 3); the payload is exactly one tunnel
 *     payload (peer-manager header + RPC), the same bytes TCP frames carry
 *     after its 4-byte length prefix.
 *  4. either side may send `FIN` (msg 4).
 *
 * There is no per-direction conn id: both directions use the conn id chosen by
 * the initiator, and the session is keyed by (source address, source port,
 * conn id). A session is only created after a valid SYN, so arbitrary
 * datagrams cannot allocate state.
 */

export const UDP_TUNNEL_HEADER_SIZE = 8;

export const enum UdpPacketType {
  Syn = 1,
  Sack = 2,
  Data = 3,
  Fin = 4,
}

interface UdpHeader {
  connId: number;
  type: number;
  length: number;
}

function decodeHeader(buffer: Buffer): UdpHeader | null {
  if (buffer.length < UDP_TUNNEL_HEADER_SIZE) return null;
  return {
    connId: buffer.readUInt32LE(0),
    type: buffer[4]!,
    length: buffer.readUInt16LE(6),
  };
}

function encodeControl(
  connId: number,
  type: UdpPacketType,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  const header = Buffer.allocUnsafe(UDP_TUNNEL_HEADER_SIZE);
  header.writeUInt32LE(connId >>> 0, 0);
  header[4] = type;
  header[5] = 0;
  header.writeUInt16LE(payload.length, 6);
  return Buffer.concat([header, payload]);
}

export interface UdpConfigServerListenerOptions {
  host: string;
  port: number;
  logger: Logger;
  onTransport: (transport: FrameTransport) => void;
  /** Drop a session that receives no datagrams for this long. */
  sessionIdleTimeoutMs?: number;
  /** Hard cap on concurrent UDP sessions (default 2000). */
  maxSessions?: number;
}

interface Session {
  key: string;
  connId: number;
  address: string;
  port: number;
  transport: UdpFrameTransport;
  lastSeen: number;
}

class UdpFrameTransport implements FrameTransport {
  readonly kind = "udp" as const;
  readonly frames = new FrameQueue();
  readonly remoteAddress: string;
  private closed = false;

  constructor(
    private readonly listener: UdpConfigServerListener,
    private readonly socket: DgramSocket,
    private readonly session: Session,
    readonly label: string,
  ) {
    this.remoteAddress = session.address;
  }

  sendFrame(tunnelPayload: Buffer): void {
    if (this.closed) return;
    if (tunnelPayload.length > 65_507 - UDP_TUNNEL_HEADER_SIZE) {
      throw new Error(`udp: tunnel payload too large (${tunnelPayload.length})`);
    }
    const datagram = encodeControl(this.session.connId, UdpPacketType.Data, tunnelPayload);
    this.socket.send(
      datagram,
      this.session.port,
      this.session.address,
      (error) => {
        if (error) this.frames.end(error);
      },
    );
  }

  receive(payload: Buffer): void {
    this.session.lastSeen = Date.now();
    if (this.closed) return;
    this.frames.push(payload);
  }

  /** Called by the listener when it closes the session (FIN/idle/shutdown). */
  markClosed(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.frames.end(error);
  }

  close(): void {
    if (this.closed) return;
    const datagram = encodeControl(this.session.connId, UdpPacketType.Fin);
    this.socket.send(datagram, this.session.port, this.session.address, () => undefined);
    this.markClosed();
    this.listener.removeSession(this.session.key, undefined, false);
  }
}

export class UdpConfigServerListener {
  private socket: DgramSocket | undefined;
  private actualPort = 0;
  private readonly sessions = new Map<string, Session>();
  private reaper: NodeJS.Timeout | undefined;
  private readonly maxSessions: number;
  private readonly sessionIdleTimeoutMs: number;

  constructor(private readonly options: UdpConfigServerListenerOptions) {
    this.maxSessions = options.maxSessions ?? 2_000;
    this.sessionIdleTimeoutMs = options.sessionIdleTimeoutMs ?? 120_000;
  }

  async start(): Promise<number> {
    const socket = createSocket({ type: "udp4", reuseAddr: false });
    this.socket = socket;
    socket.on("message", (message, remote) => this.onDatagram(message, remote));
    socket.on("error", (error) =>
      this.options.logger.error("udp listener error", { error: String(error) }),
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(this.options.port, this.options.host, () => resolve());
    });
    const address = socket.address();
    this.actualPort = address.port;
    this.reaper = setInterval(() => this.reapIdleSessions(), 10_000);
    this.reaper.unref?.();
    return this.actualPort;
  }

  get port(): number {
    return this.actualPort;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  private key(remote: RemoteInfo, connId: number): string {
    return `${remote.address}:${remote.port}:${connId}`;
  }

  private onDatagram(message: Buffer, remote: RemoteInfo): void {
    const header = decodeHeader(message);
    if (!header) return;
    if (header.length !== message.length - UDP_TUNNEL_HEADER_SIZE) {
      this.options.logger.debug("udp: header length mismatch", {
        remote: `${remote.address}:${remote.port}`,
        declared: header.length,
        actual: message.length - UDP_TUNNEL_HEADER_SIZE,
      });
      return;
    }
    if (header.length > MAX_INBOUND_FRAME_BYTES) return;

    const key = this.key(remote, header.connId);
    switch (header.type) {
      case UdpPacketType.Syn: {
        if (header.length < 8) return;
        const magic = message.subarray(UDP_TUNNEL_HEADER_SIZE, UDP_TUNNEL_HEADER_SIZE + 8);
        const existing = this.sessions.get(key);
        if (existing) {
          // A retransmitted SYN (the client resends until it sees a SACK) must
          // be answered again without allocating a second session.
          this.sendControl(remote, header.connId, UdpPacketType.Sack, magic);
          return;
        }
        if (this.sessions.size >= this.maxSessions) {
          this.options.logger.warn("udp session cap reached", {
            sessions: this.sessions.size,
            maxSessions: this.maxSessions,
          });
          this.sendControl(remote, header.connId, UdpPacketType.Fin);
          return;
        }
        const session = {
          key,
          connId: header.connId,
          address: remote.address,
          port: remote.port,
          lastSeen: Date.now(),
        } as Session;
        const label = `udp://${remote.address}:${remote.port}#${header.connId >>> 0}`;
        session.transport = new UdpFrameTransport(this, this.socket!, session, label);
        this.sessions.set(key, session);
        this.sendControl(remote, header.connId, UdpPacketType.Sack, magic);
        this.options.logger.debug("udp session accepted", { remote: label });
        this.options.onTransport(session.transport);
        return;
      }
      case UdpPacketType.Data: {
        const session = this.sessions.get(key);
        if (!session) {
          // Data without a session: tell the peer to start over.
          this.sendControl(remote, header.connId, UdpPacketType.Fin);
          return;
        }
        if (header.length < PEER_MANAGER_HEADER_SIZE) return;
        session.transport.receive(
          message.subarray(UDP_TUNNEL_HEADER_SIZE, UDP_TUNNEL_HEADER_SIZE + header.length),
        );
        return;
      }
      case UdpPacketType.Fin: {
        if (this.sessions.has(key)) this.removeSession(key, undefined, true);
        return;
      }
      default:
        // SACK from a peer is not expected on the server side; ignore.
        return;
    }
  }

  private sendControl(
    remote: RemoteInfo,
    connId: number,
    type: UdpPacketType,
    payload: Buffer = Buffer.alloc(0),
  ): void {
    this.socket?.send(encodeControl(connId, type, payload), remote.port, remote.address, () => undefined);
  }

  /** Removes a session; optionally reports an error to the framed transport. */
  removeSession(key: string, error?: Error, notifyClose = true): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    if (notifyClose) session.transport.markClosed(error);
  }

  private reapIdleSessions(now = Date.now()): void {
    for (const [key, session] of this.sessions) {
      if (now - session.lastSeen <= this.sessionIdleTimeoutMs) continue;
      this.removeSession(key, new Error("udp session idle timeout"));
    }
  }

  async stop(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = undefined;
    const socket = this.socket;
    this.socket = undefined;
    for (const key of [...this.sessions.keys()]) {
      this.removeSession(key, new Error("udp listener stopped"));
    }
    if (!socket) return;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}
