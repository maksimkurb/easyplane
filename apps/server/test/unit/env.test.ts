import { describe, expect, it } from "vitest";

import { readEnv } from "@easyplane/server";

const base = {
  NODE_ENV: "test",
  EASYPLANE_ENCRYPTION_KEY: "ab".repeat(32),
} satisfies NodeJS.ProcessEnv;

describe("environment parsing", () => {
  it("applies defaults", () => {
    const env = readEnv(base);
    expect(env.httpPort).toBe(8080);
    expect(env.wsPort).toBe(22023);
    expect(env.tcpPort).toBe(22020);
    expect(env.wss).toBeNull();
    expect(env.oidcProviders).toEqual([]);
    expect(env.secureCookies).toBe(false);
    expect(env.bootstrapReenable).toBe(false);
    expect(env.sessionIdleMs).toBe(720 * 60_000);
  });

  it("parses several OIDC providers", () => {
    const env = readEnv({
      ...base,
      EASYPLANE_OIDC_PROVIDERS: JSON.stringify([
        {
          id: "keycloak",
          issuer: "https://sso.example.com/realms/main",
          clientId: "easyplane",
          adminGroups: ["admins"],
          memberGroups: ["members"],
        },
        {
          id: "authentik",
          issuer: "https://auth.example.com/application/o/easyplane/",
          clientId: "easyplane",
          defaultRole: "member",
        },
      ]),
    });
    expect(env.oidcProviders.map((provider) => provider.id)).toEqual([
      "keycloak",
      "authentik",
    ]);
    expect(env.oidcProviders[0]).toMatchObject({
      roleClaim: "groups",
      adminGroups: ["admins"],
      defaultRole: "viewer",
      useUserinfo: true,
    });
    expect(env.oidcProviders[1]!.defaultRole).toBe("member");
  });

  it("rejects duplicate provider ids", () => {
    const provider = {
      id: "same",
      issuer: "https://idp.example.com",
      clientId: "c",
    };
    expect(() =>
      readEnv({
        ...base,
        EASYPLANE_OIDC_PROVIDERS: JSON.stringify([provider, provider]),
      }),
    ).toThrow(/duplicate OIDC provider/);
  });

  it("rejects malformed provider JSON", () => {
    expect(() =>
      readEnv({ ...base, EASYPLANE_OIDC_PROVIDERS: "{" }),
    ).toThrow(/valid JSON/);
    expect(() =>
      readEnv({
        ...base,
        EASYPLANE_OIDC_PROVIDERS: JSON.stringify([{ id: "x" }]),
      }),
    ).toThrow();
  });

  it("requires an encryption key in production", () => {
    expect(() =>
      readEnv({ NODE_ENV: "production" } satisfies NodeJS.ProcessEnv),
    ).toThrow(/EASYPLANE_ENCRYPTION_KEY/);
    expect(
      readEnv({ ...base, NODE_ENV: "production" }).secureCookies,
    ).toBe(true);
  });

  it("requires a certificate for the built-in wss listener", () => {
    expect(() =>
      readEnv({ ...base, EASYPLANE_WSS_PORT: "22024" }),
    ).toThrow(/EASYPLANE_TLS_CERT/);
    const env = readEnv({
      ...base,
      EASYPLANE_WSS_PORT: "22024",
      EASYPLANE_TLS_CERT: "/certs/cert.pem",
      EASYPLANE_TLS_KEY: "/certs/key.pem",
    });
    expect(env.wss).toEqual({
      port: 22024,
      certFile: "/certs/cert.pem",
      keyFile: "/certs/key.pem",
    });
  });

  it("honours explicit secure-cookie/trust-proxy overrides", () => {
    const env = readEnv({
      ...base,
      EASYPLANE_SECURE_COOKIES: "true",
      EASYPLANE_TRUST_PROXY: "false",
    });
    expect(env.secureCookies).toBe(true);
    expect(env.trustProxy).toBe(false);
  });
});
