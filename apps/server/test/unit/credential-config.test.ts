import { describe, expect, it } from "vitest";

import {
  buildManagedCredentials,
  buildMemberSecureMode,
  buildNetworkConfig,
  configMatchesDesired,
  normalizeDesiredConfig,
} from "@easyplane/server";
import { credentialPublicKey } from "../../src/security/credential-keys.js";

const secret = Buffer.alloc(32, 3).toString("base64");
const publicKey = credentialPublicKey(secret);

function base(overrides: Record<string, unknown> = {}) {
  return {
    networkId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    instanceId: "33333333-3333-4333-8333-333333333333",
    hostname: "member-1",
    networkName: "net",
    assignedIpv4: "10.144.144.2",
    ipv4Cidr: "10.144.144.0/24",
    stored: normalizeDesiredConfig({}),
    ...overrides,
  };
}

describe("credential-mode NetworkConfig", () => {
  it("pushes a member with its X25519 key and no network secret", () => {
    const config = buildNetworkConfig(
      base({
        memberCredentialSecret: secret,
        secureMode: true,
      }),
    );
    expect(config.networkSecret).toBeUndefined();
    expect(config.secureMode?.enabled).toBe(true);
    expect(config.secureMode?.localPrivateKey).toBe(secret);
    // A member never receives a trust list: only anchors publish one.
    expect(config.managedCredentials ?? []).toEqual([]);
  });

  it("pushes an anchor with the secret and the trusted credential list", () => {
    const managed = buildManagedCredentials([
      {
        credentialId: "c-1",
        secret,
        publicKey,
        groups: ["tag:web"],
        allowRelay: true,
        allowedProxyCidrs: [],
        expiryUnix: 2_000_000_000,
        reusable: true,
      },
    ]);
    const config = buildNetworkConfig(
      base({
        networkSecret: "network-secret",
        managedCredentials: managed,
        secureMode: true,
      }),
    );
    expect(config.networkSecret).toBe("network-secret");
    expect(config.secureMode?.enabled).toBe(true);
    // An anchor lets the client generate its own Noise key: the credential
    // trust root is the secret, not a keypair.
    expect(config.secureMode?.localPrivateKey).toBeUndefined();
    expect(config.managedCredentials).toHaveLength(1);
    expect(config.managedCredentials?.[0]?.credentialSecret).toBe(secret);
  });

  it("matches a member config reported back with its derived public key", () => {
    const wanted = buildNetworkConfig(base({ memberCredentialSecret: secret }));
    const remote = {
      ...wanted,
      networkSecret: undefined,
      secureMode: { enabled: true, localPrivateKey: secret, localPublicKey: publicKey },
    };
    expect(configMatchesDesired(remote, wanted)).toBe(true);
    // A different credential key is drift.
    expect(
      configMatchesDesired(
        {
          ...remote,
          secureMode: {
            enabled: true,
            localPrivateKey: secret,
            localPublicKey: Buffer.alloc(32, 1).toString("base64"),
          },
        },
        wanted,
      ),
    ).toBe(false);
  });

  it("detects a shared-secret config where a credential member is expected", () => {
    const wanted = buildNetworkConfig(base({ memberCredentialSecret: secret }));
    const remote = { ...wanted, networkSecret: "still-the-old-secret" };
    expect(configMatchesDesired(remote, wanted)).toBe(false);
  });

  it("detects managed-credential drift on an anchor (revoke/renew repush)", () => {
    const entry = {
      credentialId: "c-1",
      secret,
      publicKey,
      groups: [],
      allowRelay: true,
      allowedProxyCidrs: [],
      expiryUnix: 2_000_000_000,
      reusable: true,
    };
    const wanted = buildNetworkConfig(
      base({
        networkSecret: "s",
        managedCredentials: buildManagedCredentials([entry]),
        secureMode: true,
      }),
    );
    expect(configMatchesDesired(wanted, wanted)).toBe(true);
    expect(
      configMatchesDesired(
        { ...wanted, managedCredentials: buildManagedCredentials([]) },
        wanted,
      ),
    ).toBe(false);
    expect(
      configMatchesDesired(
        {
          ...wanted,
          managedCredentials: buildManagedCredentials([
            { ...entry, expiryUnix: 2_100_000_000 },
          ]),
        },
        wanted,
      ),
    ).toBe(false);
  });

  it("builds the member secure mode exactly as gen_config expects", () => {
    expect(buildMemberSecureMode({ secret })).toEqual({
      enabled: true,
      localPrivateKey: secret,
    });
  });
});
