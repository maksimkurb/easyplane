import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";

/**
 * EasyTier credential keys are raw X25519 keypairs:
 *
 * - `credential_secret` is `base64(32-byte X25519 private scalar)`
 *   (`credential_manager.rs`: `StaticSecret::from(private_bytes)`);
 * - the trusted entry published over OSPF carries the derived X25519 public
 *   key (`PublicKey::from(&private)`).
 *
 * The panel must generate credential keys without Rust, so we wrap 32 random
 * bytes in the fixed PKCS#8 envelope for the X25519 OID (1.3.101.110) and let
 * Node derive the public key. Node and `x25519-dalek` both clamp the scalar,
 * so the derived public key is identical (verified against the real
 * easytier-core: a member presenting a Node-generated key is accepted by an
 * anchor that received the same secret in `managed_credentials`).
 */
const PKCS8_X25519_PREFIX = Buffer.from(
  "302e020100300506032b656e04220420",
  "hex",
);

export interface CredentialKeypair {
  /** `base64(32-byte X25519 private key)` — the EasyTier `credential_secret`. */
  secret: string;
  /** `base64(32-byte X25519 public key)` — safe to show and audit. */
  publicKey: string;
}

function privateKeyFromRaw(raw: Buffer) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_X25519_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
}

/** Raw 32-byte private scalar of an X25519 key from Node. */
function rawPrivateBytes(key: ReturnType<typeof createPrivateKey>): Buffer {
  const der = key.export({ format: "der", type: "pkcs8" });
  return Buffer.from(der.subarray(der.length - 32));
}

/** `base64(32-byte X25519 public key)` derived from a credential secret. */
export function credentialPublicKey(secretBase64: string): string {
  const raw = Buffer.from(secretBase64.trim(), "base64");
  if (raw.length !== 32) {
    throw new Error("credential secret must be base64 of exactly 32 bytes");
  }
  const der = createPublicKey(privateKeyFromRaw(raw)).export({
    format: "der",
    type: "spki",
  });
  return Buffer.from(der.subarray(der.length - 32)).toString("base64");
}

/** Fresh credential keypair, byte-compatible with easytier-core. */
export function generateCredentialKeypair(): CredentialKeypair {
  const raw = randomBytes(32);
  const secret = rawPrivateBytes(privateKeyFromRaw(raw)).toString("base64");
  return { secret, publicKey: credentialPublicKey(secret) };
}

/** `true` when the value is a base64 32-byte key (cheap validation). */
export function isCredentialKey(value: string): boolean {
  const raw = Buffer.from(value.trim(), "base64");
  return raw.length === 32 && raw.toString("base64") === value.trim();
}
