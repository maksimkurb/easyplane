import { describe, expect, it } from "vitest";

import { SecureDatagramSession, buildTunnelPayload, PacketType } from "@easyplane/server";

/** 16-byte peer-manager header + a small RPC-sized body. */
function innerPayload(index: number): Buffer {
  const payload = Buffer.from(`rpc-${index}`.padEnd(140, "."));
  return buildTunnelPayload(payload, {
    fromPeerId: 1,
    toPeerId: 1,
    packetType: PacketType.RpcReq,
  });
}

describe("web-secure epoch rotation soak", () => {
  it(
    "survives 40k packets in both directions while rotating every 1000",
    () => {
      const root = Buffer.alloc(32, 0x42);
      const options = { rotateAfterPackets: 1_000n };
      const initiator = SecureDatagramSession.initiator(root, options);
      const responder = SecureDatagramSession.responder(root, options);
      const iterations = 40_000;

      for (let index = 0; index < iterations; index += 1) {
        const plaintext = innerPayload(index);
        const sealed = initiator.seal(plaintext);
        expect(responder.open(sealed).equals(plaintext)).toBe(true);

        const reply = innerPayload(iterations + index);
        const sealedReply = responder.seal(reply);
        expect(initiator.open(sealedReply).equals(reply)).toBe(true);
      }

      // 40k packets / 1000 per epoch = 40 rotations in each direction.
      expect(initiator.currentSendEpoch).toBe(40);
      expect(responder.currentSendEpoch).toBe(40);
    },
    120_000,
  );

  it("still rejects a replayed packet after the surrounding epochs rotated", () => {
    const root = Buffer.alloc(32, 0x24);
    const initiator = SecureDatagramSession.initiator(root, {
      rotateAfterPackets: 10n,
    });
    const responder = SecureDatagramSession.responder(root, {
      rotateAfterPackets: 10n,
    });

    // Move several epochs forward.
    for (let index = 0; index < 35; index += 1) {
      expect(responder.open(initiator.seal(innerPayload(index))).length).toBeGreaterThan(16);
    }
    const replay = initiator.seal(innerPayload(999));
    expect(responder.open(replay).length).toBeGreaterThan(16);
    expect(() => responder.open(replay)).toThrow(/replay/);
  });

  it("rotates on the 10-minute clock as well as on the packet counter", () => {
    let now = 1_000_000;
    const options = { now: () => now, rotateAfterMs: 10 * 60_000 };
    const root = Buffer.alloc(32, 0x11);
    const initiator = SecureDatagramSession.initiator(root, options);
    const responder = SecureDatagramSession.responder(root, options);

    const first = innerPayload(1);
    expect(responder.open(initiator.seal(first)).equals(first)).toBe(true);
    expect(initiator.currentSendEpoch).toBe(0);

    now += 10 * 60_000 + 1;
    const second = innerPayload(2);
    expect(responder.open(initiator.seal(second)).equals(second)).toBe(true);
    expect(initiator.currentSendEpoch).toBe(1);
  });
});
