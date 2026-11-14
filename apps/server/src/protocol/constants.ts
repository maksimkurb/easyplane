/**
 * Wire-level constants for the EasyTier tunnel + RPC framing.
 *
 * Derived from the pinned upstream sources (see docs/PROTOCOL.md):
 * - easytier-core/src/packet/mod.rs   (headers, packet types, flags)
 * - easytier-core/src/tunnel/framed.rs (TCP length framing)
 * - easytier/src/tunnel/websocket.rs  (WS message framing)
 */

/** `TCPTunnelHeader`: u32 LE length of (peer-manager header + payload). */
export const TCP_TUNNEL_HEADER_SIZE = 4;

/** `PeerManagerHeader`: from, to, type, flags, forward_counter, reserved, len. */
export const PEER_MANAGER_HEADER_SIZE = 16;

/** `StandardAeadTail`: 16-byte GCM tag followed by a 12-byte nonce. */
export const AEAD_TAG_SIZE = 16;
export const AEAD_NONCE_SIZE = 12;
export const AEAD_TAIL_SIZE = AEAD_TAG_SIZE + AEAD_NONCE_SIZE;

/** Mirror of `PacketType` in easytier-core/src/packet/mod.rs. */
export enum PacketType {
  Invalid = 0,
  Data = 1,
  HandShake = 2,
  RoutePacket = 3,
  Ping = 4,
  Pong = 5,
  TaRpc = 6,
  Route = 7,
  RpcReq = 8,
  RpcResp = 9,
  ForeignNetworkPacket = 10,
  KcpSrc = 11,
  KcpDst = 12,
  NoiseHandshakeMsg1 = 13,
  NoiseHandshakeMsg2 = 14,
  NoiseHandshakeMsg3 = 15,
  QuicSrc = 16,
  QuicDst = 17,
  DataWithKcpSrcModified = 18,
  DataWithQuicSrcModified = 19,
  RelayHandshake = 20,
  RelayHandshakeAck = 21,
}

/** Mirror of `PeerManagerHeaderFlags`. */
export const PEER_HEADER_FLAG_ENCRYPTED = 0b0000_0001;
export const PEER_HEADER_FLAG_LATENCY_FIRST = 0b0000_0010;
export const PEER_HEADER_FLAG_EXIT_NODE = 0b0000_0100;
export const PEER_HEADER_FLAG_NO_PROXY = 0b0000_1000;
export const PEER_HEADER_FLAG_COMPRESSED = 0b0001_0000;

/**
 * `web_security.rs`: magic prefix that marks the first tunnel payload as a Noise
 * handshake message instead of an RPC packet.
 */
export const NOISE_MAGIC = Buffer.from("ET_WEB_NOISE_V1:", "utf8");
export const NOISE_PROLOGUE = Buffer.from("easytier-webclient-noise-v1", "utf8");
export const NOISE_PATTERN = "Noise_NN_25519_ChaChaPoly_SHA256";

/** `web_security.rs`: how long the server waits for a possible Noise msg1. */
export const SECURE_ACCEPT_TIMEOUT_MS = 3000;

/** `framed.rs`: TCP tunnel MTU used by the Rust side for inbound frames. */
export const TCP_MTU_BYTES = 2000;

/**
 * Local safety bound for accepted TCP frames. The Rust `FramedReader` is
 * constructed with the tunnel MTU (2000), but RPC responses from clients can
 * carry network info, so we are deliberately more permissive on read and keep
 * our own writes small.
 */
export const MAX_INBOUND_FRAME_BYTES = 64 * 1024;
