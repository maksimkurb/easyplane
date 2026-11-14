import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const CIPHER = "aes-256-gcm";
const KEY_BYTES = 32;

export function parseEncryptionKey(raw: string): Buffer {
  if (raw.trim() === "") {
    throw new Error("encryption key is not configured");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === KEY_BYTES) return base64;
  const base64url = Buffer.from(raw, "base64url");
  if (base64url.length === KEY_BYTES) return base64url;
  throw new Error(
    "EASYPLANE_ENCRYPTION_KEY must be 32 bytes encoded as base64, base64url or 64 hex chars",
  );
}

/**
 * AES-256-GCM at-rest encryption for the EasyTier network secret.
 * Payload format: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: string | Buffer) {
    this.key = typeof key === "string" ? parseEncryptionKey(key) : key;
    if (this.key.length !== KEY_BYTES) {
      throw new Error("SecretBox requires a 32-byte key");
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(CIPHER, this.key, iv);
    cipher.setAAD(Buffer.from("easyplane-secret-v1"));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      "v1",
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(payload: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") {
      throw new Error("unsupported secret payload");
    }
    const iv = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    const decipher = createDecipheriv(CIPHER, this.key, iv);
    decipher.setAAD(Buffer.from("easyplane-secret-v1"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }

  /**
   * Derives a stable secret (hex) from the master key and a domain plus parts.
   * Used for EasyTier ACL group secrets, which must never be stored: the same
   * inputs always produce the same secret, and it is not recoverable without
   * `EASYPLANE_ENCRYPTION_KEY`.
   */
  derive(domain: string, ...parts: string[]): string {
    return createHmac("sha256", this.key)
      .update(domain)
      .update("\u0000")
      .update(parts.join("\u0000"))
      .digest("hex");
  }
}

/** 32 bytes of entropy by default; used for invite and session tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Constant-time string comparison. Both values are hashed first so the
 * comparison does not leak length either.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** RFC 4122-shaped deterministic UUID (version 5-ish) for EasyTier instance ids. */
export function deterministicUuid(namespace: string, ...parts: string[]): string {
  const hex = sha256Hex([namespace, ...parts].join("\u0000")).slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}8${hex.slice(17)}`;
  return [
    versioned.slice(0, 8),
    versioned.slice(8, 12),
    versioned.slice(12, 16),
    versioned.slice(16, 20),
    versioned.slice(20, 32),
  ].join("-");
}

export function newId(): string {
  return randomUUID();
}

/** High-entropy EasyTier network secret (32 base64url chars). */
export function generateNetworkSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
