import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import { common } from "@easyplane/proto";

import { PEER_MANAGER_HEADER_SIZE, PacketType } from "../protocol/constants.js";
import { buildTunnelPayload, decodePeerManagerHeader } from "../protocol/peer-header.js";
import type { TunnelLink } from "../transport/link.js";
import {
  RPC_FROM_PEER,
  RPC_TO_PEER,
  type RpcDescriptor,
} from "./descriptors.js";
import {
  RpcRemoteError,
  decodeRpcPacket,
  decodeRpcRequest,
  decodeRpcResponse,
  decompressBody,
  encodeRpcPacket,
  encodeRpcRequest,
  encodeRpcResponse,
  makeRemoteError,
  remoteErrorToMessage,
} from "./codec.js";

export type RpcHandler = (body: Uint8Array) => Promise<Uint8Array>;

interface ServiceEntry {
  handlers: Map<number, RpcHandler>;
}

interface PendingPieces {
  isRequest: boolean;
  fromPeer: number;
  toPeer: number;
  transactionId: bigint;
  totalPieces: number;
  pieces: Array<Uint8Array | null>;
  descriptor?: common.RpcDescriptor | undefined;
  compressionInfo?: common.RpcCompressionInfo | undefined;
  traceId: number;
  updatedAt: number;
}

interface PendingCall {
  resolve: (value: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RpcSessionEvents {
  packet: [direction: "in" | "out", bytes: number];
  request: [descriptor: RpcDescriptor];
  error: [error: Error];
  closed: [];
}

const DEFAULT_TIMEOUT_MS = 5000;
const PIECE_IDLE_TIMEOUT_MS = 10_000;

/**
 * Encoded RpcPacket budget for outbound requests. Upstream's TCP tunnel reader
 * uses a 2000-byte MTU (framed.rs `TCP_MTU_BYTES`), and EasyTier splits RPC
 * bodies into pieces for a ~1300-byte UDP budget regardless of transport
 * (rpc/packet.rs). Staying at 1200 bytes of protobuf leaves room for the 4-byte
 * TCP length, the 16-byte peer-manager header and the web-secure AEAD tail.
 */
const MAX_PIECE_ENCODED_BYTES = 1200;

function serviceKey(descriptor: { domainName: string; protoName: string; serviceName: string }): string {
  return `${descriptor.domainName}\u0000${descriptor.protoName}\u0000${descriptor.serviceName}`;
}

/**
 * A bidirectional EasyTier RPC channel over one tunnel link.
 *
 * Framing per easytier-core/src/rpc/{packet,client,server}.rs:
 *   tunnel payload = PeerManagerHeader{packet_type=RpcReq|RpcResp} + RpcPacket
 *   RpcPacket.body = RpcRequest / RpcResponse (optionally compressed)
 */
export class RpcSession extends EventEmitter<RpcSessionEvents> {
  readonly id = randomUUID();
  readonly label: string;
  readonly remoteAddress: string;
  readonly transportKind: TunnelLink["transportKind"];
  readonly secure: boolean;

  private readonly services = new Map<string, ServiceEntry>();
  private readonly pendingCalls = new Map<string, PendingCall>();
  private readonly pieces = new Map<string, PendingPieces>();
  private nextTransactionId: bigint;
  private closed = false;
  private closeError: Error | undefined;

  readonly stats = {
    requestsIn: 0,
    responsesIn: 0,
    requestsOut: 0,
    responsesOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    startedAt: Date.now(),
  };

  constructor(private readonly link: TunnelLink) {
    super();
    this.label = link.label;
    this.remoteAddress = link.remoteAddress;
    this.transportKind = link.transportKind;
    this.secure = link.secure;
    this.nextTransactionId = BigInt(1 + Math.floor(Math.random() * 0x7fffffff));
  }

  register(descriptor: Omit<RpcDescriptor, "methodIndex">, methodIndex: number, handler: RpcHandler): void {
    const key = serviceKey(descriptor);
    let entry = this.services.get(key);
    if (!entry) {
      entry = { handlers: new Map() };
      this.services.set(key, entry);
    }
    entry.handlers.set(methodIndex, handler);
  }

  /** Background receive loop; resolves when the link closes. */
  async run(): Promise<void> {
    try {
      for (;;) {
        const tunnelPayload = await this.link.nextPacket();
        if (tunnelPayload === null) break;
        this.handleTunnelPayload(tunnelPayload);
      }
    } catch (error) {
      this.closeError = error instanceof Error ? error : new Error(String(error));
      this.emit("error", this.closeError);
    } finally {
      this.finishClose();
    }
  }

  private handleTunnelPayload(tunnelPayload: Buffer): void {
    this.stats.bytesIn += tunnelPayload.length;
    let header;
    let packet: common.RpcPacket;
    try {
      header = decodePeerManagerHeader(tunnelPayload);
      packet = decodeRpcPacket(tunnelPayload.subarray(PEER_MANAGER_HEADER_SIZE));
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (header.packetType !== PacketType.RpcReq && header.packetType !== PacketType.RpcResp) {
      // The config-server channel only carries RPC traffic; other packet types
      // (Ping/Pong/Data) are not part of this protocol.
      return;
    }

    let complete: common.RpcPacket | null;
    try {
      complete = this.feedPacket(packet);
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (complete === null) return;

    if (complete.isRequest) {
      this.stats.requestsIn += 1;
      void this.dispatch(complete);
    } else {
      this.stats.responsesIn += 1;
      this.resolveCall(complete);
    }
  }

  private feedPacket(packet: common.RpcPacket): common.RpcPacket | null {
    const total = packet.totalPieces;
    const idx = packet.pieceIdx;
    if (total === 0 && idx === 0) return packet;
    if (total <= 0 || total > 32 * 1024) {
      throw new Error(`malformed rpc packet: total_pieces=${total}`);
    }
    if (idx >= total) {
      throw new Error(`malformed rpc packet: piece_idx=${idx} >= total_pieces=${total}`);
    }

    const key = `${packet.isRequest ? "req" : "resp"}:${packet.fromPeer}:${packet.transactionId}`;
    let entry = this.pieces.get(key);
    if (!entry || entry.totalPieces !== total) {
      entry = {
        isRequest: packet.isRequest,
        fromPeer: packet.fromPeer,
        toPeer: packet.toPeer,
        transactionId: packet.transactionId,
        totalPieces: total,
        pieces: new Array<Uint8Array | null>(total).fill(null),
        traceId: packet.traceId,
        updatedAt: Date.now(),
      };
      this.pieces.set(key, entry);
    }
    entry.updatedAt = Date.now();
    if (idx === 0) {
      entry.descriptor = packet.descriptor;
      entry.compressionInfo = packet.compressionInfo;
    }
    entry.pieces[idx] = packet.body;

    this.evictStalePieces();
    if (entry.pieces.some((piece) => piece === null)) return null;
    this.pieces.delete(key);

    return {
      fromPeer: entry.fromPeer,
      toPeer: entry.toPeer,
      transactionId: entry.transactionId,
      descriptor: entry.descriptor,
      body: Buffer.concat(entry.pieces as Uint8Array[]),
      isRequest: entry.isRequest,
      totalPieces: 1,
      pieceIdx: 0,
      traceId: entry.traceId,
      compressionInfo: entry.compressionInfo,
    };
  }

  private evictStalePieces(): void {
    const now = Date.now();
    for (const [key, entry] of this.pieces) {
      if (now - entry.updatedAt > PIECE_IDLE_TIMEOUT_MS) this.pieces.delete(key);
    }
  }

  private async dispatch(packet: common.RpcPacket): Promise<void> {
    if (!packet.descriptor) {
      this.emit("error", new Error("rpc request without descriptor"));
      return;
    }
    const descriptor: RpcDescriptor = {
      domainName: packet.descriptor.domainName,
      protoName: packet.descriptor.protoName,
      serviceName: packet.descriptor.serviceName,
      methodIndex: packet.descriptor.methodIndex,
    };
    this.emit("request", descriptor);

    const entry = this.services.get(
      serviceKey({ domainName: "", protoName: descriptor.protoName, serviceName: descriptor.serviceName }),
    );
    let response: common.RpcResponse;
    const startedAt = process.hrtime.bigint();
    try {
      if (!entry) {
        throw new RpcRemoteError(
          `invalid service: ${descriptor.protoName}.${descriptor.serviceName}`,
          "invalidService",
        );
      }
      const handler = entry.handlers.get(descriptor.methodIndex);
      if (!handler) {
        throw new RpcRemoteError(
          `invalid method index ${descriptor.methodIndex} for ${descriptor.serviceName}`,
          "invalidMethodIndex",
        );
      }
      const compression = packet.compressionInfo;
      const requestBody = compression
        ? decompressBody(compression.algo, packet.body)
        : Buffer.from(packet.body);
      const request = decodeRpcRequest(requestBody);
      const output = await handler(request.request);
      response = {
        response: output,
        runtimeUs: BigInt(Math.round(Number(process.hrtime.bigint() - startedAt) / 1000)),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response = {
        response: new Uint8Array(0),
        error: makeRemoteError(message),
        runtimeUs: BigInt(Math.round(Number(process.hrtime.bigint() - startedAt) / 1000)),
      };
    }
    this.sendResponse(packet, response);
  }

  private sendResponse(request: common.RpcPacket, response: common.RpcResponse): void {
    // The handler may close the session itself (blocked device, rate limit);
    // there is nobody left to answer in that case.
    if (this.closed) return;
    const body = encodeRpcResponse(response);
    const rpcPacket: common.RpcPacket = {
      fromPeer: request.toPeer,
      toPeer: request.fromPeer,
      transactionId: request.transactionId,
      descriptor: request.descriptor,
      body,
      isRequest: false,
      totalPieces: 1,
      pieceIdx: 0,
      traceId: request.traceId,
      // Deliberately no compression_info: the client then leaves response
      // bodies uncompressed (see easytier-core/src/rpc/server.rs).
    };
    try {
      this.sendRpcPacket(rpcPacket);
      this.stats.responsesOut += 1;
    } catch (error) {
      // The link can close between the `closed` check and the write.
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private sendRpcPacket(packet: common.RpcPacket): void {
    if (this.closed) throw new Error("rpc session is closed");
    const payload = encodeRpcPacket(packet);
    const tunnelPayload = buildTunnelPayload(payload, {
      fromPeerId: packet.fromPeer,
      toPeerId: packet.toPeer,
      packetType: packet.isRequest ? PacketType.RpcReq : PacketType.RpcResp,
    });
    this.link.sendPacket(tunnelPayload);
    this.stats.bytesOut += tunnelPayload.length;
    this.emit("packet", "out", tunnelPayload.length);
  }

  /** Invoke a method on the peer's service and await its decoded response. */
  call(options: {
    descriptor: Omit<RpcDescriptor, "methodIndex"> & { methodIndex: number };
    payload: Uint8Array;
    timeoutMs?: number;
    fromPeer?: number;
    toPeer?: number;
  }): Promise<Buffer> {
    if (this.closed) return Promise.reject(new Error("rpc session is closed"));

    const fromPeer = options.fromPeer ?? RPC_FROM_PEER;
    const toPeer = options.toPeer ?? RPC_TO_PEER;
    const transactionId = this.nextTransactionId;
    this.nextTransactionId += 1n;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const body = encodeRpcRequest({
      request: options.payload,
      timeoutMs,
    });

    const rpcPacket: common.RpcPacket = {
      fromPeer,
      toPeer,
      transactionId,
      descriptor: {
        domainName: options.descriptor.domainName,
        protoName: options.descriptor.protoName,
        serviceName: options.descriptor.serviceName,
        methodIndex: options.descriptor.methodIndex,
      },
      body,
      isRequest: true,
      totalPieces: 1,
      pieceIdx: 0,
      traceId: 0,
    };

    const key = `${fromPeer}:${toPeer}:${transactionId}`;
    const promise = new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(key);
        reject(new Error(`rpc timeout after ${timeoutMs}ms (${options.descriptor.serviceName})`));
      }, timeoutMs);
      timer.unref?.();
      this.pendingCalls.set(key, { resolve, reject, timer });
    });

    try {
      for (const piece of this.splitRequest(rpcPacket)) this.sendRpcPacket(piece);
      this.stats.requestsOut += 1;
    } catch (error) {
      const pending = this.pendingCalls.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCalls.delete(key);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return promise;
  }

  /**
   * Split an RPC request body into `total_pieces`/`piece_idx` pieces, mirroring
   * `split_rpc_content_for_udp_budget` (rpc/packet.rs). Every piece repeats the
   * descriptor, as upstream does when the body is not compressed; receivers use
   * piece 0's descriptor.
   */
  private splitRequest(packet: common.RpcPacket): common.RpcPacket[] {
    const body = Buffer.from(packet.body);
    if (body.length <= MAX_PIECE_ENCODED_BYTES / 2) {
      return [{ ...packet, totalPieces: 1, pieceIdx: 0 }];
    }

    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < body.length) {
      let length = Math.min(MAX_PIECE_ENCODED_BYTES, body.length - offset);
      for (;;) {
        const probe: common.RpcPacket = {
          ...packet,
          body: body.subarray(offset, offset + length),
          totalPieces: 127,
          pieceIdx: chunks.length,
        };
        const encoded = common.RpcPacket.encode(probe).finish().length;
        if (encoded <= MAX_PIECE_ENCODED_BYTES || length <= 1) break;
        length = Math.max(1, length - 32);
      }
      chunks.push(body.subarray(offset, offset + length));
      offset += length;
    }

    if (chunks.length === 1) return [{ ...packet, totalPieces: 1, pieceIdx: 0 }];
    if (chunks.length > 127) {
      throw new Error(`rpc request too large to split: ${chunks.length} pieces`);
    }
    return chunks.map((chunk, pieceIdx) => ({
      ...packet,
      body: chunk,
      totalPieces: chunks.length,
      pieceIdx,
    }));
  }

  private resolveCall(packet: common.RpcPacket): void {
    const key = `${packet.fromPeer}:${packet.toPeer}:${packet.transactionId}`;
    const pending = this.pendingCalls.get(key);
    if (!pending) {
      this.emit("error", new Error(`rpc response without matching request (${key})`));
      return;
    }
    this.pendingCalls.delete(key);
    clearTimeout(pending.timer);

    try {
      const body = packet.compressionInfo
        ? decompressBody(packet.compressionInfo.algo, packet.body)
        : Buffer.from(packet.body);
      const response = decodeRpcResponse(body);
      if (response.error) throw remoteErrorToMessage(response.error);
      pending.resolve(Buffer.from(response.response));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  close(reason?: string): void {
    if (this.closed) return;
    this.link.close();
    this.finishClose(new Error(reason ?? "closed"));
  }

  private finishClose(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (error && !this.closeError) this.closeError = error;
    for (const pending of this.pendingCalls.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.closeError ?? new Error("rpc session closed"));
    }
    this.pendingCalls.clear();
    this.pieces.clear();
    this.emit("closed");
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get lastError(): Error | undefined {
    return this.closeError;
  }
}
