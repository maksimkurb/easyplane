import { describe, expect, it } from "vitest";

import {
  SecretBox,
  allocateIpv4,
  constantTimeEqual,
  deterministicUuid,
  generateNetworkSecret,
  parseCidr,
  parseEncryptionKey,
  parseIpv4,
  sanitizeAuditMetadata,
  sha256Hex,
} from "@easyplane/server";

const KEY = "11".repeat(32);

describe("secret box", () => {
  it("round-trips a secret and uses a fresh IV", () => {
    const box = new SecretBox(KEY);
    const first = box.encrypt("s3cret");
    const second = box.encrypt("s3cret");
    expect(first).not.toBe(second);
    expect(box.decrypt(first)).toBe("s3cret");
    expect(box.decrypt(second)).toBe("s3cret");
  });

  it("rejects a tampered payload", () => {
    const box = new SecretBox(KEY);
    const payload = box.encrypt("s3cret");
    const parts = payload.split(".");
    parts[3] = `${parts[3]!.slice(0, -2)}AA`;
    expect(() => box.decrypt(parts.join("."))).toThrow();
  });

  it("rejects the wrong key", () => {
    const payload = new SecretBox(KEY).encrypt("s3cret");
    expect(() => new SecretBox("22".repeat(32)).decrypt(payload)).toThrow();
  });

  it("parses base64, base64url and hex keys", () => {
    const buffer = Buffer.alloc(32, 9);
    expect(parseEncryptionKey(buffer.toString("hex"))).toEqual(buffer);
    expect(parseEncryptionKey(buffer.toString("base64"))).toEqual(buffer);
    expect(parseEncryptionKey(buffer.toString("base64url"))).toEqual(buffer);
    expect(() => parseEncryptionKey("short")).toThrow();
  });

  it("generates high-entropy network secrets", () => {
    const secret = generateNetworkSecret();
    expect(secret.length).toBeGreaterThanOrEqual(30);
    expect(new Set(Array.from({ length: 20 }, generateNetworkSecret)).size).toBe(20);
  });
});

describe("hashing and constant-time compare", () => {
  it("hashes invitations deterministically without keeping the token", () => {
    const token = "invite-token";
    expect(sha256Hex(token)).toBe(sha256Hex(token));
    expect(sha256Hex(token)).not.toContain(token);
    expect(sha256Hex(token)).toHaveLength(64);
  });

  it("compares without leaking length", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  it("derives stable instance UUIDs", () => {
    const first = deterministicUuid("ns", "network", "device");
    expect(first).toBe(deterministicUuid("ns", "network", "device"));
    expect(first).not.toBe(deterministicUuid("ns", "network", "other"));
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("IPv4 allocation", () => {
  it("allocates from .2 upward, skipping used addresses", () => {
    expect(parseCidr("10.0.0.0/24").prefix).toBe(24);
    expect(allocateIpv4("10.0.0.0/24", [])).toBe("10.0.0.2");
    expect(allocateIpv4("10.0.0.0/24", ["10.0.0.2", "10.0.0.3"])).toBe(
      "10.0.0.4",
    );
    expect(allocateIpv4("10.0.0.0/24", ["10.0.0.2", "10.0.0.4"])).toBe(
      "10.0.0.3",
    );
  });

  it("does not allocate outside the network", () => {
    expect(allocateIpv4("192.168.5.0/30", [])).toBe("192.168.5.2");
    expect(allocateIpv4("192.168.5.0/30", ["192.168.5.2"])).toBeNull();
  });

  it("parses addresses", () => {
    expect(parseIpv4("255.255.255.255")).toBe(0xffffffff);
    expect(() => parseIpv4("1.2.3")).toThrow();
    expect(() => parseIpv4("1.2.3.999")).toThrow();
  });
});

describe("audit metadata sanitising", () => {
  it("drops secret-looking keys recursively", () => {
    expect(
      sanitizeAuditMetadata({
        networkSecret: "nope",
        nested: { inviteToken: "nope", keep: 1, list: [{ password: "x", ok: true }] },
        Authorization: "Bearer x",
        fine: "yes",
      }),
    ).toEqual({ nested: { keep: 1, list: [{ ok: true }] }, fine: "yes" });
  });
});
