import { describe, expect, it } from "vitest";

import { common } from "@easyplane/proto";
import {
  FrameQueue,
  PacketType,
  RpcSession,
  WEB_CLIENT_SERVICE,
  WebClientMethod,
  buildTunnelPayload,
  decodePeerManagerHeader,
} from "@easyplane/server";
import type { TunnelLink } from "@easyplane/server";
import { PEER_MANAGER_HEADER_SIZE } from "@easyplane/server";

class MemoryLink implements TunnelLink {
  readonly transportKind = "ws" as const;
  readonly label = "memory";
  readonly secure = false;
  readonly queue = new FrameQueue();
  peer!: MemoryLink;

  static pair(): [MemoryLink, MemoryLink] {
    const a = new MemoryLink();
    const b = new MemoryLink();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  nextPacket(): Promise<Buffer | null> {
    return this.queue.next();
  }

  sendPacket(tunnelPayload: Buffer): void {
    this.peer.queue.push(Buffer.from(tunnelPayload));
  }

  close(): void {
    this.queue.end();
    this.peer.queue.end();
  }
}

const TEST_SERVICE = { domainName: "", protoName: "TestService", serviceName: "TestService" };

function decodeResponseFrame(tunnelPayload: Buffer): common.RpcResponse {
  const header = decodePeerManagerHeader(tunnelPayload);
  expect(header.packetType).toBe(PacketType.RpcResp);
  const packet = common.RpcPacket.decode(tunnelPayload.subarray(PEER_MANAGER_HEADER_SIZE));
  return common.RpcResponse.decode(packet.body);
}

describe("RPC session (easytier-core/src/rpc/*)", () => {
  it("round-trips a request/response with upstream peer ids and 1-based method indexes", async () => {
    const [a, b] = MemoryLink.pair();
    const server = new RpcSession(a);
    const client = new RpcSession(b);
    const received: Buffer[] = [];
    server.register(TEST_SERVICE, 1, async (body) => {
      received.push(Buffer.from(body));
      return Buffer.from("pong");
    });

    void server.run();
    void client.run();

    const response = await client.call({
      descriptor: { ...TEST_SERVICE, methodIndex: 1 },
      payload: Buffer.from("ping"),
    });
    expect(response.toString()).toBe("pong");
    expect(received[0]?.toString()).toBe("ping");
    client.close();
    server.close();
  });

  it("returns a remote error for unknown services", async () => {
    const [a, b] = MemoryLink.pair();
    const server = new RpcSession(a);
    const client = new RpcSession(b);
    void server.run();
    void client.run();

    await expect(
      client.call({
        descriptor: { domainName: "", protoName: "Nope", serviceName: "Nope", methodIndex: 1 },
        payload: new Uint8Array(),
      }),
    ).rejects.toThrow(/invalid service/);
    client.close();
    server.close();
  });

  it("reassembles multi-piece requests like PacketMerger", async () => {
    const [a, b] = MemoryLink.pair();
    const server = new RpcSession(a);
    let handlerBody: Buffer | undefined;
    server.register(TEST_SERVICE, 1, async (body) => {
      handlerBody = Buffer.from(body);
      return Buffer.from("ok");
    });
    void server.run();

    const payload = Buffer.from("x".repeat(3000));
    const request = common.RpcRequest.encode({ request: payload, timeoutMs: 5000 }).finish();
    const chunks = [request.subarray(0, 1000), request.subarray(1000, 2000), request.subarray(2000)];
    for (const [index, chunk] of chunks.entries()) {
      const packet: common.RpcPacket = {
        fromPeer: 1,
        toPeer: 1,
        transactionId: 42n,
        descriptor:
          index === 0
            ? { domainName: "", protoName: "TestService", serviceName: "TestService", methodIndex: 1 }
            : undefined,
        body: chunk,
        isRequest: true,
        totalPieces: chunks.length,
        pieceIdx: index,
        traceId: 0,
      };
      a.queue.push(
        buildTunnelPayload(Buffer.from(common.RpcPacket.encode(packet).finish()), {
          fromPeerId: 1,
          toPeerId: 1,
          packetType: PacketType.RpcReq,
        }),
      );
    }

    const responseFrame = await b.queue.next(2000);
    expect(responseFrame).not.toBeNull();
    const response = decodeResponseFrame(responseFrame!);
    expect(Buffer.from(response.response).toString()).toBe("ok");
    expect(handlerBody?.equals(payload)).toBe(true);
    server.close();
  });

  it("keeps 64-bit transaction ids exact (forceLong=bigint)", () => {
    const transactionId = 9007199254740993n; // 2^53 + 1
    const encoded = common.RpcPacket.encode({
      fromPeer: 1,
      toPeer: 1,
      transactionId,
      body: new Uint8Array(0),
      isRequest: true,
      totalPieces: 1,
      pieceIdx: 0,
      traceId: 0,
    }).finish();
    expect(common.RpcPacket.decode(encoded).transactionId).toBe(transactionId);
  });

  it("exposes WebClientService descriptors with upstream method indexes", () => {
    expect(WEB_CLIENT_SERVICE.serviceName).toBe("WebClientService");
    expect(WebClientMethod.RunNetworkInstance).toBe(2);
    expect(WebClientMethod.CollectNetworkInfo).toBe(4);
    expect(WebClientMethod.GetNetworkInstanceConfig).toBe(7);
  });
});
