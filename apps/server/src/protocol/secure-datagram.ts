import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";

import {
  AEAD_NONCE_SIZE,
  AEAD_TAG_SIZE,
  PEER_MANAGER_HEADER_SIZE,
  PEER_HEADER_FLAG_ENCRYPTED,
  PacketType,
} from "./constants.js";
import { buildTunnelPayload, decodePeerManagerHeader } from "./peer-header.js";

/**
 * Traffic-key + packet encryption used after the web-secure Noise handshake.
 *
 * Derived from the pinned upstream sources:
 * - easytier-core/src/tunnel/secure_datagram.rs (HKDF, epochs, AES-GCM nonce)
 * - easytier-core/src/tunnel/encrypt/aes_gcm.rs   (tag||nonce tail, no AAD)
 * - easytier-core/src/tunnel/web_security.rs      (aes-gcm = AES-128-GCM)
 */

export const enum SecureDirection {
  /** Initiator -> responder. */
  AToB = 0,
  /** Responder -> initiator. */
  BToA = 1,
}

const ROTATE_AFTER_PACKETS_DEFAULT = 1_000_000n;
const ROTATE_AFTER_MS_DEFAULT = 10 * 60 * 1000;
const MAX_ACCEPTED_RX_EPOCH_AHEAD = 3;
const REPLAY_WINDOW_BITS = 256;

function hmacSha256(key: Buffer, ...parts: Buffer[]): Buffer {
  const h = createHmac("sha256", key);
  for (const part of parts) h.update(part);
  return h.digest();
}

/**
 * `SecureDatagramSession::hkdf_traffic_key`: HKDF-Extract with a zero salt, then
 * one expand step over `"et-traffic" || epoch_be || dir`.
 */
export function deriveTrafficKey(rootKey: Buffer, epoch: number, dir: SecureDirection): Buffer {
  if (rootKey.length !== 32) throw new Error("secure: root key must be 32 bytes");
  const prk = hmacSha256(Buffer.alloc(32), rootKey);
  const epochBytes = Buffer.alloc(4);
  epochBytes.writeUInt32BE(epoch >>> 0, 0);
  // Upstream appends the 10-byte label, then a BE epoch and the direction byte
  // (the `9 + 4 + 1` in secure_datagram.rs is only the Vec capacity hint).
  const info = Buffer.concat([Buffer.from("et-traffic", "ascii"), epochBytes, Buffer.from([dir])]);
  return hmacSha256(prk, info, Buffer.from([1]));
}

function nonceFrom(epoch: number, seq: bigint): Buffer {
  const nonce = Buffer.alloc(AEAD_NONCE_SIZE);
  nonce.writeUInt32BE(epoch >>> 0, 0);
  nonce.writeBigUInt64BE(seq, 4);
  return nonce;
}

/** AES-128-GCM seal with the EasyTier `tag || nonce` tail and no AAD. */
export function sealAeadPayload(key128: Buffer, nonce: Buffer, plaintext: Buffer): Buffer {
  if (key128.length !== 16) throw new Error("secure: aes-128-gcm key must be 16 bytes");
  if (nonce.length !== AEAD_NONCE_SIZE) throw new Error("secure: nonce must be 12 bytes");
  const cipher = createCipheriv("aes-128-gcm", key128, nonce, { authTagLength: AEAD_TAG_SIZE });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag(), nonce]);
}

/** Inverse of `sealAeadPayload`. */
export function openAeadPayload(key128: Buffer, payload: Buffer): Buffer {
  if (payload.length < AEAD_TAG_SIZE + AEAD_NONCE_SIZE) {
    throw new Error(`secure: payload too short (${payload.length})`);
  }
  const nonce = payload.subarray(payload.length - AEAD_NONCE_SIZE);
  const tag = payload.subarray(payload.length - AEAD_NONCE_SIZE - AEAD_TAG_SIZE, payload.length - AEAD_NONCE_SIZE);
  const ciphertext = payload.subarray(0, payload.length - AEAD_NONCE_SIZE - AEAD_TAG_SIZE);
  const decipher = createDecipheriv("aes-128-gcm", key128, nonce, { authTagLength: AEAD_TAG_SIZE });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

class ReplayWindow {
  private maxSeq = -1n;
  private readonly seen = new Set<bigint>();

  /** Returns false for replayed or too-old sequence numbers. */
  accept(seq: bigint): boolean {
    if (this.maxSeq < 0n) {
      this.maxSeq = seq;
      this.seen.add(seq);
      return true;
    }
    if (seq > this.maxSeq) {
      this.maxSeq = seq;
      this.seen.add(seq);
      // Keep the set bounded: only remember the last 256 sequence numbers.
      const floor = this.maxSeq - BigInt(REPLAY_WINDOW_BITS);
      for (const value of this.seen) {
        if (value <= floor) this.seen.delete(value);
      }
      return true;
    }
    if (this.maxSeq - seq >= BigInt(REPLAY_WINDOW_BITS)) return false;
    if (this.seen.has(seq)) return false;
    this.seen.add(seq);
    return true;
  }
}

interface EpochState {
  epoch: number;
  window: ReplayWindow;
}

export interface SecureSessionOptions {
  /** Packets per epoch before rotating (default 1,000,000, like upstream). */
  rotateAfterPackets?: bigint;
  /** Wall-clock age of an epoch before rotating (default 10 minutes). */
  rotateAfterMs?: number;
  /** Injectable clock for the rotation soak test. */
  now?: () => number;
}

export class SecureDatagramSession {
  private readonly keyCache = new Map<string, Buffer>();
  private readonly rotateAfterPackets: bigint;
  private readonly rotateAfterMs: number;
  private readonly now: () => number;
  private sendEpoch = 0;
  private sendSeq = 0n;
  private sendEpochStartedMs: number;
  private sendPacketsSinceEpoch = 0n;
  private recvCur: EpochState | null = null;
  private recvPrev: EpochState | null = null;

  constructor(
    private readonly rootKey: Buffer,
    private readonly sendDir: SecureDirection,
    private readonly recvDir: SecureDirection,
    options: SecureSessionOptions = {},
  ) {
    this.rotateAfterPackets = options.rotateAfterPackets ?? ROTATE_AFTER_PACKETS_DEFAULT;
    this.rotateAfterMs = options.rotateAfterMs ?? ROTATE_AFTER_MS_DEFAULT;
    this.now = options.now ?? Date.now;
    this.sendEpochStartedMs = this.now();
  }

  /** Server side of the web-secure tunnel (responder). */
  static responder(
    rootKey: Buffer,
    options: SecureSessionOptions = {},
  ): SecureDatagramSession {
    return new SecureDatagramSession(
      rootKey,
      SecureDirection.BToA,
      SecureDirection.AToB,
      options,
    );
  }

  /**
   * Client side of the tunnel (initiator). EasyTier itself only implements the
   * responder, so this exists for tests and client-side tooling (the load test
   * and the epoch-rotation soak).
   */
  static initiator(
    rootKey: Buffer,
    options: SecureSessionOptions = {},
  ): SecureDatagramSession {
    return new SecureDatagramSession(
      rootKey,
      SecureDirection.AToB,
      SecureDirection.BToA,
      options,
    );
  }

  get currentSendEpoch(): number {
    return this.sendEpoch;
  }

  private trafficKey(epoch: number, dir: SecureDirection): Buffer {
    const cacheKey = `${epoch}:${dir}`;
    const cached = this.keyCache.get(cacheKey);
    if (cached) return cached;
    const key = deriveTrafficKey(this.rootKey, epoch, dir);
    // Bound the cache: keep only the epochs we can still send/receive on.
    if (this.keyCache.size > 16) this.keyCache.clear();
    this.keyCache.set(cacheKey, key);
    return key;
  }

  private maybeRotate(): void {
    this.sendPacketsSinceEpoch += 1n;
    const expired = this.now() - this.sendEpochStartedMs >= this.rotateAfterMs;
    if (this.sendPacketsSinceEpoch < this.rotateAfterPackets && !expired) return;
    this.sendEpoch = (this.sendEpoch + 1) >>> 0;
    this.sendSeq = 0n;
    this.sendPacketsSinceEpoch = 0n;
    this.sendEpochStartedMs = this.now();
  }

  /**
   * Encrypt one *inner tunnel payload* (peer-manager header + payload) and
   * return the outer tunnel payload, mirroring `SecureDatagramTunnelFilter`.
   */
  seal(innerTunnelPayload: Buffer): Buffer {
    this.maybeRotate();
    const epoch = this.sendEpoch;
    const seq = this.sendSeq;
    this.sendSeq += 1n;

    const key = this.trafficKey(epoch, this.sendDir).subarray(0, 16);
    const nonce = nonceFrom(epoch, seq);
    const payload = sealAeadPayload(key, nonce, innerTunnelPayload);
    return buildTunnelPayload(payload, {
      fromPeerId: 0,
      toPeerId: 0,
      packetType: PacketType.Data,
      flags: PEER_HEADER_FLAG_ENCRYPTED,
      // web_security.rs fills the header before encryption, so `len` keeps the
      // plaintext length even though tag+nonce are appended to the payload.
      declaredLen: innerTunnelPayload.length,
    });
  }

  /** Decrypt an outer tunnel payload back into the inner tunnel payload. */
  open(outerTunnelPayload: Buffer): Buffer {
    const header = decodePeerManagerHeader(outerTunnelPayload);
    if ((header.flags & PEER_HEADER_FLAG_ENCRYPTED) === 0) {
      throw new Error("secure: packet is not marked encrypted");
    }
    const payload = outerTunnelPayload.subarray(PEER_MANAGER_HEADER_SIZE);
    if (payload.length < AEAD_TAG_SIZE + AEAD_NONCE_SIZE) {
      throw new Error(`secure: payload too short (${payload.length})`);
    }
    const nonce = payload.subarray(payload.length - AEAD_NONCE_SIZE);
    const epoch = nonce.readUInt32BE(0);
    const seq = nonce.readBigUInt64BE(4);
    if (!this.acceptEpochSeq(epoch, seq)) {
      throw new Error(`secure: replay rejected (epoch ${epoch}, seq ${seq})`);
    }
    const key = this.trafficKey(epoch, this.recvDir).subarray(0, 16);
    return openAeadPayload(key, payload);
  }

  private acceptEpochSeq(epoch: number, seq: bigint): boolean {
    if (this.recvCur && this.recvCur.epoch === epoch) {
      return this.recvCur.window.accept(seq);
    }
    if (this.recvPrev && this.recvPrev.epoch === epoch) {
      return this.recvPrev.window.accept(seq);
    }
    if (!this.recvCur || epoch > this.recvCur.epoch) {
      const maxAllowed = (this.recvCur?.epoch ?? this.sendEpoch) + MAX_ACCEPTED_RX_EPOCH_AHEAD;
      if (this.recvCur && epoch > maxAllowed) return false;
      this.recvPrev = this.recvCur;
      this.recvCur = { epoch, window: new ReplayWindow() };
      return this.recvCur.window.accept(seq);
    }
    return false;
  }
}
