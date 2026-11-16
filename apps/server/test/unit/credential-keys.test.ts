import { describe, expect, it } from "vitest";

import {
  credentialPublicKey,
  generateCredentialKeypair,
  isCredentialKey,
} from "../../src/security/credential-keys.js";

// RFC 7748 §6.1 Diffie-Hellman test vector (Alice's keypair):
// private scalar -> public u-coordinate. x25519-dalek and Node both clamp, so
// this is exactly the derivation `credential_secret` -> trusted pubkey uses.
const RFC_SCALAR =
  "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a";
const RFC_PUBLIC =
  "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a";

describe("credential keys (X25519, EasyTier credential_secret)", () => {
  it("derives the RFC 7748 public key from a raw scalar", () => {
    const secret = Buffer.from(RFC_SCALAR, "hex").toString("base64");
    const publicKey = credentialPublicKey(secret);
    expect(Buffer.from(publicKey, "base64").toString("hex")).toBe(RFC_PUBLIC);
  });

  it("generates 32-byte base64 keypairs whose public key matches", () => {
    const keypair = generateCredentialKeypair();
    expect(Buffer.from(keypair.secret, "base64")).toHaveLength(32);
    expect(Buffer.from(keypair.publicKey, "base64")).toHaveLength(32);
    expect(credentialPublicKey(keypair.secret)).toBe(keypair.publicKey);
    expect(isCredentialKey(keypair.secret)).toBe(true);
    expect(isCredentialKey(keypair.publicKey)).toBe(true);
  });

  it("rejects malformed secrets", () => {
    expect(() => credentialPublicKey(Buffer.alloc(16).toString("base64"))).toThrow(
      /32 bytes/,
    );
    expect(() => credentialPublicKey("not base64!!")).toThrow();
    expect(isCredentialKey("AAAA")).toBe(false);
  });

  it("is stable across calls and does not reuse a key", () => {
    const first = generateCredentialKeypair();
    const second = generateCredentialKeypair();
    expect(first.secret).not.toBe(second.secret);
    expect(first.publicKey).not.toBe(second.publicKey);
  });
});
