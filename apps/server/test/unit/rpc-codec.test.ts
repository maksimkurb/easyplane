import { describe, expect, it } from "vitest";

import { decompressBody, decompressZstdFallback, makeRemoteError, remoteErrorToMessage } from "@easyplane/server";

// zstd frame for "easyplane zstd conformance vector " repeated 4 times,
// produced by Node's zlib.zstdCompressSync (RFC 8878 frame format).
const ZSTD_VECTOR = Buffer.from(
  "28b52ffd2088550100240265617379706c616e65207a73746420636f6e666f726d616e636520766563746f722001001a25554f",
  "hex",
);
const ZSTD_PLAINTEXT = "easyplane zstd conformance vector ".repeat(4);

describe("RPC codec", () => {
  it("passes through uncompressed bodies (CompressionAlgoPb None/Invalid)", () => {
    const body = Buffer.from("plain rpc body");
    expect(decompressBody(1, body).toString()).toBe("plain rpc body");
    expect(decompressBody(0, body).toString()).toBe("plain rpc body");
  });

  it("decompresses zstd bodies with the pure-JS fallback", () => {
    expect(decompressZstdFallback(ZSTD_VECTOR).toString()).toBe(ZSTD_PLAINTEXT);
  });

  it("decompresses zstd bodies through decompressBody", () => {
    expect(decompressBody(2, ZSTD_VECTOR).toString()).toBe(ZSTD_PLAINTEXT);
  });

  it("rejects unknown compression algorithms", () => {
    expect(() => decompressBody(99, Buffer.alloc(0))).toThrow(/unsupported RPC compression/);
  });

  it("maps remote protobuf errors to messages", () => {
    const error = remoteErrorToMessage(makeRemoteError("unknown config-server token"));
    expect(error.message).toBe("unknown config-server token");
    expect(error.kind).toBe("otherError");
    expect(remoteErrorToMessage(undefined).message).toMatch(/without error details/);
  });
});
