import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
  type KeyObject,
} from "node:crypto";

/**
 * Minimal Noise responder for `Noise_NN_25519_ChaChaPoly_SHA256`, matching what
 * `snow` does on the EasyTier side (easytier-core/src/tunnel/web_security.rs).
 *
 * Only the responder half of the two messages actually used by EasyTier is
 * implemented: msg1 `-> e` and msg2 `<- e, ee` (whose payload is the 32-byte
 * web-secure root key). EasyTier never drives the pattern to completion: it
 * reads the msg2 payload and derives symmetric datagram keys from it.
 */

const PROTOCOL_NAME = Buffer.from("Noise_NN_25519_ChaChaPoly_SHA256", "utf8");
const HASHLEN = 32;
const MAXNONCE = 8;
const TAGLEN = 16;
const DHLEN = 32;

/** SPKI DER prefix for an X25519 public key (RFC 8410). */
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest();
}

function hmacSha256(key: Buffer, ...parts: Buffer[]): Buffer {
  const h = createHmac("sha256", key);
  for (const part of parts) h.update(part);
  return h.digest();
}

/** HKDF-SHA256 (RFC 5869) with a single-block-per-iteration expand. */
export function hkdf(
  salt: Buffer,
  ikm: Buffer,
  info: Buffer,
  length: number,
): { prk: Buffer; okm: Buffer } {
  const prk = hmacSha256(salt, ikm);
  const blocks = Math.ceil(length / HASHLEN);
  if (blocks > 255) throw new Error("hkdf: requested length too large");
  const out: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(0);
  for (let i = 1; i <= blocks; i += 1) {
    previous = hmacSha256(prk, previous, info, Buffer.from([i]));
    out.push(previous);
  }
  return { prk, okm: Buffer.concat(out).subarray(0, length) };
}

function nonceFor(n: bigint): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64LE(n, 4);
  return nonce;
}

/** Chacha20-Poly1305 AEAD nonce: 4 zero bytes then 64-bit little-endian n. */
function aeadNonce(n: bigint): Buffer {
  return nonceFor(n);
}

function chachaSeal(key: Buffer, nonce: bigint, ad: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv("chacha20-poly1305", key, aeadNonce(nonce), {
    authTagLength: TAGLEN,
  }) as CipherGCM;
  cipher.setAAD(ad, { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]);
}

function chachaOpen(key: Buffer, nonce: bigint, ad: Buffer, ciphertextWithTag: Buffer): Buffer {
  if (ciphertextWithTag.length < TAGLEN) throw new Error("noise: ciphertext too short");
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - TAGLEN);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - TAGLEN);
  const decipher = createDecipheriv("chacha20-poly1305", key, aeadNonce(nonce), {
    authTagLength: TAGLEN,
  }) as DecipherGCM;
  decipher.setAAD(ad, { plaintextLength: ciphertext.length });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function rawPublicKey(key: KeyObject): Buffer {
  const der = key.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - DHLEN));
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== DHLEN) throw new Error(`noise: bad x25519 public key length ${raw.length}`);
  return createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function dh(privateKey: KeyObject, publicKey: KeyObject): Buffer {
  const secret = diffieHellman({ privateKey, publicKey });
  if (secret.every((byte) => byte === 0)) throw new Error("noise: invalid x25519 shared secret");
  return secret;
}

class SymmetricState {
  h: Buffer;
  ck: Buffer;
  k: Buffer = Buffer.alloc(HASHLEN);
  n = 0n;
  /**
   * snow only AEAD-protects a handshake payload once a key exists
   * (symmetricstate.rs `encrypt_and_mix_hash` -> `has_key`); before the first
   * MixKey the payload is copied verbatim and only mixed into the hash.
   */
  hasKey = false;

  constructor(protocolName: Buffer, prologue: Buffer) {
    const initial: Buffer =
      protocolName.length > HASHLEN ? sha256(protocolName) : Buffer.concat([protocolName, Buffer.alloc(HASHLEN - protocolName.length)]);
    this.h = initial;
    this.ck = Buffer.from(initial);
    this.mixHash(prologue);
  }

  mixHash(data: Buffer): void {
    this.h = sha256(this.h, data);
  }

  mixKey(ikm: Buffer): void {
    const { okm } = hkdf(this.ck, ikm, Buffer.alloc(0), 2 * HASHLEN);
    this.ck = okm.subarray(0, HASHLEN);
    // noise: if HASHLEN == 64, truncate to 32 (AESGCM/ChaChaPoly key size).
    this.k = okm.subarray(HASHLEN, HASHLEN + 32);
    this.n = 0n;
    this.hasKey = true;
  }

  /** `EncryptAndHash`: plaintext copy + mix while no key exists. */
  encryptAndHash(plaintext: Buffer): Buffer {
    if (!this.hasKey) {
      this.mixHash(plaintext);
      return plaintext;
    }
    const ciphertext = chachaSeal(this.k, this.n, this.h, plaintext);
    this.n += 1n;
    this.mixHash(ciphertext);
    return ciphertext;
  }

  /** `DecryptAndHash`: plaintext copy + mix while no key exists. */
  decryptAndHash(ciphertext: Buffer): Buffer {
    if (!this.hasKey) {
      this.mixHash(ciphertext);
      return ciphertext;
    }
    const plaintext = chachaOpen(this.k, this.n, this.h, ciphertext);
    this.n += 1n;
    this.mixHash(ciphertext);
    return plaintext;
  }
}

export interface NoiseResponderResult {
  /** Full noise msg2 (without the `ET_WEB_NOISE_V1:` magic). */
  message: Buffer;
  /** 32-byte root key used by the secure datagram session. */
  rootKey: Buffer;
}

/**
 * Consume a Noise msg1 (already stripped of the EasyTier magic prefix) and
 * produce msg2, whose payload is a fresh 32-byte root key.
 */
export function noiseRespond(msg1: Buffer, prologue: Buffer): NoiseResponderResult {
  // snow writes msg1 as `e` plus a not-yet-encrypted (empty) payload: 32 bytes.
  if (msg1.length < DHLEN) {
    throw new Error(`noise: msg1 length ${msg1.length} < ${DHLEN}`);
  }

  const symmetric = new SymmetricState(PROTOCOL_NAME, prologue);
  const initiatorEphemeral = msg1.subarray(0, DHLEN);
  symmetric.mixHash(initiatorEphemeral);
  symmetric.decryptAndHash(msg1.subarray(DHLEN));

  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const responderEphemeralPublic = rawPublicKey(publicKey);

  const msg2: Buffer[] = [responderEphemeralPublic];
  symmetric.mixHash(responderEphemeralPublic);
  symmetric.mixKey(dh(privateKey, publicKeyFromRaw(initiatorEphemeral)));

  const rootKey = randomBytes(32);
  msg2.push(symmetric.encryptAndHash(rootKey));

  return { message: Buffer.concat(msg2), rootKey };
}
