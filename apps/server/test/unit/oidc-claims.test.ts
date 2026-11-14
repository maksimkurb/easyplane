import { describe, expect, it } from "vitest";

import { getGroups, mapIdentity, type OidcProviderConfig } from "@easyplane/server";

const provider: OidcProviderConfig = {
  id: "test",
  label: "Test",
  issuer: "https://idp.example.com",
  clientId: "client",
  scopes: "openid email profile",
  roleClaim: "groups",
  adminGroups: ["easyplane-admins"],
  memberGroups: ["easyplane-members", "ops"],
  defaultRole: "viewer",
  emailClaim: "email",
  nameClaim: "name",
  useUserinfo: true,
  allowedEmailDomains: [],
};

describe("OIDC claim mapping", () => {
  it("maps an admin group", () => {
    const mapped = mapIdentity(provider, {
      email: "Alice@Example.com",
      name: "Alice",
      groups: ["other", "easyplane-admins"],
    });
    expect(mapped).toMatchObject({
      role: "admin",
      email: "alice@example.com",
      displayName: "Alice",
    });
  });

  it("maps a member group", () => {
    expect(
      mapIdentity(provider, { email: "b@example.com", groups: ["ops"] }).role,
    ).toBe("member");
  });

  it("admin wins over member", () => {
    expect(
      mapIdentity(provider, {
        email: "c@example.com",
        groups: ["easyplane-members", "easyplane-admins"],
      }).role,
    ).toBe("admin");
  });

  it("falls back to the default role", () => {
    expect(
      mapIdentity(provider, { email: "d@example.com", groups: ["nobody"] }).role,
    ).toBe("viewer");
  });

  it("parses space/comma separated group strings", () => {
    expect(
      getGroups({ groups: "ops, easyplane-admins  others" }, "groups"),
    ).toEqual(["ops", "easyplane-admins", "others"]);
    expect(
      mapIdentity(provider, { email: "e@example.com", groups: "easyplane-admins" })
        .role,
    ).toBe("admin");
  });

  it("uses preferred_username as display name fallback", () => {
    expect(
      mapIdentity(provider, {
        email: "f@example.com",
        preferred_username: "frank",
      }).displayName,
    ).toBe("frank");
  });

  it("rejects missing email", () => {
    expect(() => mapIdentity(provider, { sub: "x" })).toThrow(/email/);
  });

  it("enforces allowed email domains", () => {
    const restricted: OidcProviderConfig = {
      ...provider,
      allowedEmailDomains: ["example.com"],
    };
    expect(() =>
      mapIdentity(restricted, { email: "user@evil.test" }),
    ).toThrow(/not allowed/);
    expect(
      mapIdentity(restricted, { email: "user@example.com" }).role,
    ).toBe("viewer");
  });

  it("honours a custom role claim and email claim", () => {
    const custom: OidcProviderConfig = {
      ...provider,
      roleClaim: "realm_access.roles",
      emailClaim: "upn",
      adminGroups: ["platform"],
    };
    expect(
      mapIdentity(custom, {
        upn: "user@example.com",
        "realm_access.roles": ["platform"],
      }).role,
    ).toBe("admin");
  });
});
