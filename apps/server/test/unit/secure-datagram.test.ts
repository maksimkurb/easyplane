import { describe, expect, it } from "vitest";

import {
  PacketType,
  SecureDatagramSession,
  buildTunnelPayload,
  deriveTrafficKey,
  decodePeerManagerHeader,
  openAeadPayload,
  sealAeadPayload,
} from "@easyplane/server";

describe("secure datagram", () => {
  it("derives traffic keys exactly like secure_datagram.rs", () => {
    // Golden values computed independently (HMAC-SHA256 HKDF over
    // "et-traffic" || epoch_be32 || dir, extract salt = 32 zero bytes).
    const rootKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    expect(deriveTrafficKey(rootKey, 0, 0).toString("hex")).toBe(
      "5f6aeafd4b1a023ef03ae837e7138631a416a1629d0cd3a97ec039d39c04add7",
    );
    expect(deriveTrafficKey(rootKey, 5, 1).toString("hex")).toBe(
      "b81cacbf4b060e4b0bd43aaac530f80564f9737c328b4b857dd21583d37f025b",
    );
  });

  it("matches the AES-128-GCM vector from encrypt/ring.rs", () => {
    const key = Buffer.alloc(16);
    const nonce = Buffer.alloc(12);
    const plaintext = Buffer.alloc(16);
    const sealed = sealAeadPayload(key, nonce, plaintext);
    expect(sealed.toString("hex")).toBe(
      "0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf" +
        "000000000000000000000000",
    );
    expect(openAeadPayload(key, sealed).equals(plaintext)).toBe(true);
  });

  it("round-trips tunnel payloads between the two directions", () => {
    const rootKey = Buffer.alloc(32, 7);
    const initiator = SecureDatagramSession.initiator(rootKey);
    const responder = SecureDatagramSession.responder(rootKey);

    const inner = buildTunnelPayload(Buffer.from("rpc-bytes"), {
      fromPeerId: 1,
      toPeerId: 1,
      packetType: PacketType.RpcReq,
    });
    const sealed = initiator.seal(inner);
    // Outer header is the encrypted AEAD data packet (from/to zero).
    const outerHeader = decodePeerManagerHeader(sealed);
    expect(outerHeader.packetType).toBe(PacketType.Data);
    expect(outerHeader.flags & 1).toBe(1);
    expect(responder.open(sealed).equals(inner)).toBe(true);

    // The responder must encrypt with the BToA key, not AToB.
    const reply = responder.seal(inner);
    expect(initiator.open(reply).equals(inner)).toBe(true);
    expect(() => responder.open(sealed)).toThrow();
  });

  it("rejects replayed sequence numbers", () => {
    const rootKey = Buffer.alloc(32, 9);
    const initiator = SecureDatagramSession.initiator(rootKey);
    const responder = SecureDatagramSession.responder(rootKey);
    const inner = buildTunnelPayload(Buffer.from("once"), {
      fromPeerId: 1,
      toPeerId: 1,
      packetType: PacketType.RpcReq,
    });
    const sealed = initiator.seal(inner);
    expect(responder.open(sealed).equals(inner)).toBe(true);
    expect(() => responder.open(sealed)).toThrow(/replay/);
  });
});
