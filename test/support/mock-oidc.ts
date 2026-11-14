import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { SignJWT, exportJWK, generateKeyPair } from "jose";

export interface MockUser {
  sub: string;
  email: string;
  name: string;
  groups: string[];
}

export const MOCK_USERS = {
  admin: {
    sub: "mock-admin",
    email: "admin@example.com",
    name: "Ada Admin",
    groups: ["easyplane-admins", "staff"],
  },
  member: {
    sub: "mock-member",
    email: "member@example.com",
    name: "Mia Member",
    groups: ["easyplane-members"],
  },
  viewer: {
    sub: "mock-viewer",
    email: "viewer@example.com",
    name: "Vic Viewer",
    groups: [],
  },
  outsider: {
    sub: "mock-outsider",
    email: "someone@other.test",
    name: "Otto Outsider",
    groups: ["easyplane-admins"],
  },
} satisfies Record<string, MockUser>;

interface AuthorizationCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
  user: MockUser;
  used: boolean;
}

export interface MockIdp {
  issuer: string;
  port: number;
  stop: () => Promise<void>;
}

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * Minimal OpenID Provider for integration tests: discovery, JWKS, authorization
 * code + PKCE, token and userinfo. Groups are intentionally exposed only via
 * userinfo so the client's claim merging is exercised.
 */
export async function startMockIdp(): Promise<MockIdp> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const kid = "mock-key-1";
  const codes = new Map<string, AuthorizationCode>();
  const accessTokens = new Map<string, MockUser>();

  let issuer = "";

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuer || "http://127.0.0.1");
    const json = (status: number, body: unknown): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "email", "profile"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      });
      return;
    }

    if (url.pathname === "/jwks") {
      json(200, {
        keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }],
      });
      return;
    }

    if (url.pathname === "/authorize") {
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const nonce = url.searchParams.get("nonce") ?? "";
      const challenge = url.searchParams.get("code_challenge") ?? "";
      const method = url.searchParams.get("code_challenge_method");
      if (!clientId || !redirectUri || !state || !nonce || !challenge || method !== "S256") {
        json(400, { error: "invalid_request" });
        return;
      }
      const requested = url.searchParams.get("login_hint") ?? "admin";
      const user =
        MOCK_USERS[requested as keyof typeof MOCK_USERS] ?? MOCK_USERS.admin;
      const code = randomBytes(16).toString("base64url");
      codes.set(code, {
        clientId,
        redirectUri,
        codeChallenge: challenge,
        nonce,
        user,
        used: false,
      });
      const location = new URL(redirectUri);
      location.searchParams.set("code", code);
      location.searchParams.set("state", state);
      response.writeHead(302, { location: location.toString() });
      response.end();
      return;
    }

    if (url.pathname === "/token" && request.method === "POST") {
      const body = new URLSearchParams(await readBody(request));
      const code = body.get("code") ?? "";
      const verifier = body.get("code_verifier") ?? "";
      const entry = codes.get(code);
      if (!entry || entry.used) {
        json(400, { error: "invalid_grant" });
        return;
      }
      if (body.get("redirect_uri") !== entry.redirectUri) {
        json(400, { error: "invalid_grant", error_description: "redirect_uri" });
        return;
      }
      if (body.get("client_id") !== entry.clientId) {
        json(400, { error: "invalid_client" });
        return;
      }
      const expected = createHash("sha256").update(verifier).digest("base64url");
      if (expected !== entry.codeChallenge) {
        json(400, { error: "invalid_grant", error_description: "pkce" });
        return;
      }
      entry.used = true;
      const accessToken = randomBytes(16).toString("base64url");
      accessTokens.set(accessToken, entry.user);
      const idToken = await new SignJWT({
        email: entry.user.email,
        name: entry.user.name,
        nonce: entry.nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuer(issuer)
        .setAudience(entry.clientId)
        .setSubject(entry.user.sub)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      json(200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
      return;
    }

    if (url.pathname === "/userinfo") {
      const header = request.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      const user = accessTokens.get(token);
      if (!user) {
        json(401, { error: "invalid_token" });
        return;
      }
      json(200, {
        sub: user.sub,
        email: user.email,
        name: user.name,
        groups: user.groups,
      });
      return;
    }

    json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    port: address.port,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
