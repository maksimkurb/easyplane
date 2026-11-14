import * as zlib from "node:zlib";

import { common, error as protoError } from "@easyplane/proto";

/** RPC-level failure surfaced by the remote peer (`common.RpcResponse.error`). */
export class RpcRemoteError extends Error {
  constructor(
    message: string,
    readonly kind: string,
  ) {
    super(message);
    this.name = "RpcRemoteError";
  }
}

/** `CompressionAlgoPb` values from common.proto. */
const COMPRESSION_NONE = 1;
const COMPRESSION_ZSTD = 2;

/**
 * Decompress an RPC body. EasyTier only compresses when the peer advertised a
 * smaller payload; zstd support was added to Node after v22, so probe instead
 * of assuming.
 */
export function decompressBody(algo: number, body: Uint8Array): Buffer {
  const input = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (algo === COMPRESSION_NONE || algo === 0) return input;
  if (algo === COMPRESSION_ZSTD) {
    const zstd = zlib as unknown as {
      zstdDecompressSync?: (buffer: Buffer) => Buffer;
    };
    if (typeof zstd.zstdDecompressSync !== "function") {
      throw new Error(
        "received a zstd-compressed RPC body but this Node build has no zstd support " +
          "(run Node >= 23.8, or the client will normally not compress because the " +
          "server advertises no accepted algorithm)",
      );
    }
    return zstd.zstdDecompressSync(input);
  }
  throw new Error(`unsupported RPC compression algorithm: ${algo}`);
}

export function decodeRpcPacket(payload: Uint8Array): common.RpcPacket {
  return common.RpcPacket.decode(payload);
}

export function encodeRpcPacket(packet: common.RpcPacket): Buffer {
  return Buffer.from(common.RpcPacket.encode(packet).finish());
}

export function encodeRpcRequest(request: common.RpcRequest): Buffer {
  return Buffer.from(common.RpcRequest.encode(request).finish());
}

export function decodeRpcRequest(body: Uint8Array): common.RpcRequest {
  return common.RpcRequest.decode(body);
}

export function encodeRpcResponse(response: common.RpcResponse): Buffer {
  return Buffer.from(common.RpcResponse.encode(response).finish());
}

export function decodeRpcResponse(body: Uint8Array): common.RpcResponse {
  return common.RpcResponse.decode(body);
}

export function remoteErrorToMessage(error: protoError.Error | undefined): RpcRemoteError {
  const kind = error?.errorKind;
  if (!kind) return new RpcRemoteError("rpc failed without error details", "unknown");
  switch (kind.$case) {
    case "otherError":
      return new RpcRemoteError(kind.otherError.errorMessage, kind.$case);
    case "executeError":
      return new RpcRemoteError(kind.executeError.errorMessage, kind.$case);
    case "timeout":
      return new RpcRemoteError(kind.timeout.errorMessage || "rpc timeout", kind.$case);
    case "invalidService":
      return new RpcRemoteError(`invalid service: ${kind.invalidService.serviceName}`, kind.$case);
    case "invalidMethodIndex":
      return new RpcRemoteError(
        `invalid method ${kind.invalidMethodIndex.methodIndex} on ${kind.invalidMethodIndex.serviceName}`,
        kind.$case,
      );
    case "malformatRpcPacket":
      return new RpcRemoteError(kind.malformatRpcPacket.errorMessage, kind.$case);
    default:
      return new RpcRemoteError(`rpc failed: ${kind.$case}`, kind.$case);
  }
}

export function makeRemoteError(message: string): protoError.Error {
  return { errorKind: { $case: "otherError", otherError: { errorMessage: message } } };
}
