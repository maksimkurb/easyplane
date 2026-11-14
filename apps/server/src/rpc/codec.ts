import * as zlib from "node:zlib";

import { decompress as fzstdDecompress } from "fzstd";

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
 * zstd decompression. Node only gained `zlib.zstdDecompressSync` in 23.8, while
 * the brief targets Node 22+, so fall back to the pure-JS `fzstd` decoder.
 *
 * A config-server client can legitimately send zstd request bodies: it learns
 * the peer's `accepted_algo` from earlier responses (see
 * easytier-core/src/rpc/client.rs) and compresses only when the result is
 * smaller than the raw body.
 */
export function decompressZstd(input: Buffer): Buffer {
  const zstd = zlib as unknown as {
    zstdDecompressSync?: (buffer: Buffer) => Buffer;
  };
  if (typeof zstd.zstdDecompressSync === "function") {
    return zstd.zstdDecompressSync(input);
  }
  return decompressZstdFallback(input);
}

/** Pure-JS zstd path, exported so tests exercise it on every Node version. */
export function decompressZstdFallback(input: Buffer): Buffer {
  return Buffer.from(fzstdDecompress(input));
}

export function decompressBody(algo: number, body: Uint8Array): Buffer {
  const input = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (algo === COMPRESSION_NONE || algo === 0) return input;
  if (algo === COMPRESSION_ZSTD) return decompressZstd(input);
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
