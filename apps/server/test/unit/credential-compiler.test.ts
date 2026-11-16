import { describe, expect, it } from "vitest";

import {
  buildManagedCredentials,
  credentialGroupsFromTags,
  credentialStatusAt,
  effectiveRole,
  isCredentialUsable,
  knowsNetworkSecret,
  managedCredentialsMatch,
  type CredentialMaterial,
} from "../../src/domain/credentials.js";

function material(overrides: Partial<CredentialMaterial> = {}): CredentialMaterial {
  return {
    credentialId: "b0000000-0000-4000-8000-000000000002",
    secret: Buffer.alloc(32, 7).toString("base64"),
    publicKey: Buffer.alloc(32, 9).toString("base64"),
    groups: ["tag:web"],
    allowRelay: true,
    allowedProxyCidrs: [],
    expiryUnix: 2_000_000_000,
    reusable: true,
    ...overrides,
  };
}

describe("credential compiler", () => {
  it("builds managed credentials sorted by id with sorted grants", () => {
    const list = buildManagedCredentials([
      material({ credentialId: "z", groups: ["tag:b", "tag:a", "tag:a"] }),
      material({ credentialId: "a", allowedProxyCidrs: ["10.0.0.0/24"] }),
    ]);
    expect(list.map((entry) => entry.credentialId)).toEqual(["a", "z"]);
    expect(list[1]!.groups).toEqual(["tag:a", "tag:b"]);
    expect(list[0]!.allowedProxyCidrs).toEqual(["10.0.0.0/24"]);
    // 64-bit protobuf fields must be bigint (forceLong=bigint).
    expect(typeof list[0]!.expiryUnix).toBe("bigint");
  });

  it("detects revoke, renew and grant drift and ignores list order", () => {
    const desired = buildManagedCredentials([
      material({ credentialId: "a" }),
      material({ credentialId: "b", groups: ["tag:db"] }),
    ]);
    const reordered = [desired[1]!, desired[0]!];
    expect(managedCredentialsMatch(reordered, desired)).toBe(true);

    const revoked = [desired[0]!];
    expect(managedCredentialsMatch(revoked, desired)).toBe(false);

    const renewed = [
      desired[0]!,
      { ...desired[1]!, expiryUnix: 2_100_000_000n },
    ];
    expect(managedCredentialsMatch(renewed, desired)).toBe(false);

    const regranted = [
      desired[0]!,
      { ...desired[1]!, groups: ["tag:other"] },
    ];
    expect(managedCredentialsMatch(regranted, desired)).toBe(false);

    const relayOff = [desired[0]!, { ...desired[1]!, allowRelay: false }];
    expect(managedCredentialsMatch(relayOff, desired)).toBe(false);

    expect(managedCredentialsMatch(undefined, desired)).toBe(false);
    expect(managedCredentialsMatch([], [])).toBe(true);
  });

  it("maps roles: shared-secret devices are always anchors", () => {
    expect(effectiveRole("shared_secret", "member")).toBe("anchor");
    expect(effectiveRole("credentials", "member")).toBe("member");
    expect(knowsNetworkSecret("shared_secret", "member")).toBe(true);
    expect(knowsNetworkSecret("credentials", "member")).toBe(false);
    expect(knowsNetworkSecret("credentials", "anchor")).toBe(true);
  });

  it("maps tags to ACL group names and deduplicates", () => {
    expect(credentialGroupsFromTags(["tag:web", "tag:web", " ", "tag:db"])).toEqual([
      "tag:db",
      "tag:web",
    ]);
  });

  it("treats expiry and revocation as unusable", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-02-01T00:00:00Z");
    expect(isCredentialUsable({ status: "active", expiry: future }, now)).toBe(true);
    expect(
      isCredentialUsable({ status: "active", expiry: new Date("2025-01-01") }, now),
    ).toBe(false);
    expect(isCredentialUsable({ status: "revoked", expiry: future }, now)).toBe(false);
    expect(
      credentialStatusAt({ status: "revoked", expiry: future }, now),
    ).toBe("revoked");
    expect(
      credentialStatusAt({ status: "active", expiry: new Date("2025-01-01") }, now),
    ).toBe("expired");
  });
});
