import { describe, expect, it } from "vitest";

import {
  PEER_MANAGER_HEADER_SIZE,
  buildTunnelPayload,
  decodePeerManagerHeader,
  PacketType,
} from "@easyplane/server";

describe("PeerManagerHeader codec", () => {
  it("matches the packed little-endian layout from packet/mod.rs", () => {
    const payload = Buffer.from("hello", "ascii");
    const tunnelPayload = buildTunnelPayload(payload, {
      fromPeerId: 1,
      toPeerId: 2,
      packetType: PacketType.RpcReq,
      flags: 0b0000_0001,
    });

    expect(tunnelPayload.length).toBe(PEER_MANAGER_HEADER_SIZE + payload.length);
    // from_peer_id, to_peer_id, packet_type, flags, forward_counter, reserved, len
    expect(tunnelPayload.readUInt32LE(0)).toBe(1);
    expect(tunnelPayload.readUInt32LE(4)).toBe(2);
    expect(tunnelPayload.readUInt8(8)).toBe(PacketType.RpcReq);
    expect(tunnelPayload.readUInt8(9)).toBe(0b0000_0001);
    expect(tunnelPayload.readUInt8(10)).toBe(1); // forward_counter
    expect(tunnelPayload.readUInt8(11)).toBe(0);
    expect(tunnelPayload.readUInt32LE(12)).toBe(payload.length);
    expect(tunnelPayload.subarray(PEER_MANAGER_HEADER_SIZE).toString("ascii")).toBe("hello");

    const decoded = decodePeerManagerHeader(tunnelPayload);
    expect(decoded).toEqual({
      fromPeerId: 1,
      toPeerId: 2,
      packetType: PacketType.RpcReq,
      flags: 1,
      forwardCounter: 1,
      reserved: 0,
      len: payload.length,
    });
  });

  it("rejects short buffers", () => {
    expect(() => decodePeerManagerHeader(Buffer.alloc(15))).toThrow(/too short/);
  });
});
