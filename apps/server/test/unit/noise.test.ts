import {
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import { NOISE_PROLOGUE, noiseRespond } from "@easyplane/server";

const PROTOCOL_NAME = Buffer.from("Noise_NN_25519_ChaChaPoly_SHA256");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function hmac(key: Buffer, ...parts: Buffer[]): Buffer {
  const mac = createHmac("sha256", key);
  for (const part of parts) mac.update(part);
  return mac.digest();
}

function expand(prk: Buffer, info: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(0);
  for (let index = 1; index <= Math.ceil(length / 32); index += 1) {
    previous = hmac(prk, previous, info, Buffer.from([index]));
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function rawPublic(key: KeyObject): Buffer {
  const der = key.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32));
}

function aeadNonce(n: bigint): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64LE(n, 4);
  return nonce;
}

/**
 * Independent NN initiator used to check the responder's message layout and
 * root-key transport. The authoritative check is the real-client conformance
 * suite; this guards against regressions in the handshake bytes.
 */
function runInitiator() {
  // Noise InitializeSymmetric: names <= HASHLEN are used verbatim (padded);
  // this protocol name is exactly 32 bytes.
  let h: Buffer =
    PROTOCOL_NAME.length <= 32
      ? Buffer.concat([PROTOCOL_NAME, Buffer.alloc(32 - PROTOCOL_NAME.length)])
      : sha256(PROTOCOL_NAME);
  let ck: Buffer = Buffer.from(h);
  h = sha256(h, NOISE_PROLOGUE);

  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const ephemeral = rawPublic(publicKey);
  h = sha256(h, ephemeral);
  // Empty msg1 payload without a key: mix_hash(empty) (snow symmetricstate.rs).
  h = sha256(h);

  const msg1 = ephemeral;

  return {
    msg1,
    finish(msg2: Buffer): { rootKey: Buffer; hashAfter: Buffer } {
      const peerEphemeral = msg2.subarray(0, 32);
      h = sha256(h, peerEphemeral);
      const ee = diffieHellman({ privateKey, publicKey: publicKeyFromRaw(peerEphemeral) });
      // MixKey(ee): HKDF(ck, ee, 2 * 32); ck = first half, cipher key = second.
      const prk = hmac(ck, ee);
      const mixed = expand(prk, Buffer.alloc(0), 64);
      ck = mixed.subarray(0, 32);
      const key = mixed.subarray(32);

      const ciphertext = msg2.subarray(32);
      const tag = ciphertext.subarray(ciphertext.length - 16);
      const body = ciphertext.subarray(0, ciphertext.length - 16);
      const decipher = createDecipheriv("chacha20-poly1305", key, aeadNonce(0n), {
        authTagLength: 16,
      });
      decipher.setAAD(h, { plaintextLength: body.length });
      decipher.setAuthTag(tag);
      const rootKey = Buffer.concat([decipher.update(body), decipher.final()]);
      h = sha256(h, ciphertext);
      return { rootKey, hashAfter: h };
    },
  };
}

describe("Noise_NN_25519_ChaChaPoly_SHA256 handshake", () => {
  it("responds with a 80-byte msg2 carrying a 32-byte root key", () => {
    const initiator = runInitiator();
    const { message, rootKey } = noiseRespond(initiator.msg1, NOISE_PROLOGUE);
    expect(message.length).toBe(80);
    expect(rootKey.length).toBe(32);

    const result = initiator.finish(message);
    expect(result.rootKey.equals(rootKey)).toBe(true);
  });

  it("rejects malformed msg1 (missing ephemeral key)", () => {
    expect(() => noiseRespond(Buffer.alloc(16), NOISE_PROLOGUE)).toThrow(/msg1 length/);
  });

  it("derives a different root key per handshake (fresh responder ephemeral)", () => {
    const first = noiseRespond(runInitiator().msg1, NOISE_PROLOGUE);
    const second = noiseRespond(runInitiator().msg1, NOISE_PROLOGUE);
    expect(first.rootKey.equals(second.rootKey)).toBe(false);
    expect(first.message.equals(second.message)).toBe(false);
  });
});
