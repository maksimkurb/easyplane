import { PEER_MANAGER_HEADER_SIZE } from "./constants.js";

/** Little-endian packed `PeerManagerHeader` (16 bytes). */
export interface PeerManagerHeader {
  fromPeerId: number;
  toPeerId: number;
  packetType: number;
  flags: number;
  forwardCounter: number;
  reserved: number;
  /** Declared payload length; equals `tunnelPayload.length - 16` when we build it. */
  len: number;
}

export function decodePeerManagerHeader(buf: Buffer): PeerManagerHeader {
  if (buf.length < PEER_MANAGER_HEADER_SIZE) {
    throw new Error(`peer manager header too short: ${buf.length}`);
  }
  return {
    fromPeerId: buf.readUInt32LE(0),
    toPeerId: buf.readUInt32LE(4),
    packetType: buf.readUInt8(8),
    flags: buf.readUInt8(9),
    forwardCounter: buf.readUInt8(10),
    reserved: buf.readUInt8(11),
    len: buf.readUInt32LE(12),
  };
}

export function encodePeerManagerHeader(header: PeerManagerHeader, out: Buffer): void {
  out.writeUInt32LE(header.fromPeerId >>> 0, 0);
  out.writeUInt32LE(header.toPeerId >>> 0, 4);
  out.writeUInt8(header.packetType & 0xff, 8);
  out.writeUInt8(header.flags & 0xff, 9);
  out.writeUInt8(header.forwardCounter & 0xff, 10);
  out.writeUInt8(header.reserved & 0xff, 11);
  out.writeUInt32LE(header.len >>> 0, 12);
}

export function isEncrypted(header: PeerManagerHeader): boolean {
  return (header.flags & 0b0000_0001) !== 0;
}

/**
 * Build a tunnel payload (peer-manager header + payload), mirroring
 * `ZCPacket::fill_peer_manager_hdr` + `tunnel_payload()`.
 */
export function buildTunnelPayload(
  payload: Uint8Array,
  opts: { fromPeerId: number; toPeerId: number; packetType: number; flags?: number },
): Buffer {
  const buf = Buffer.allocUnsafe(PEER_MANAGER_HEADER_SIZE + payload.length);
  encodePeerManagerHeader(
    {
      fromPeerId: opts.fromPeerId,
      toPeerId: opts.toPeerId,
      packetType: opts.packetType,
      flags: opts.flags ?? 0,
      forwardCounter: 1,
      reserved: 0,
      len: payload.length,
    },
    buf,
  );
  Buffer.from(payload.buffer, payload.byteOffset, payload.length).copy(buf, PEER_MANAGER_HEADER_SIZE);
  return buf;
}
