import { createHash, randomBytes } from "node:crypto";

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type RemoteJWKSet,
} from "jose";
import { z } from "zod";

import type { OidcProviderConfig } from "../env.js";
import type { Claims } from "./claims.js";

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  userinfo_endpoint: z.string().url().optional(),
  end_session_endpoint: z.string().url().optional(),
});

export type OidcDiscovery = z.infer<typeof discoverySchema>;

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export interface OidcRuntimeProvider {
  config: OidcProviderConfig;
  discovery: OidcDiscovery;
  jwks: RemoteJWKSet;
}

interface CachedDiscovery {
  discovery: OidcDiscovery;
  jwks: RemoteJWKSet;
  fetchedAt: number;
}

const DISCOVERY_TTL_MS = 60 * 60_000;

/**
 * Minimal OpenID Connect client for the authorization-code flow with PKCE.
 * Uses discovery + JWKS verification (`jose`) and no provider-specific SDK so
 * any compliant IdP can be configured through env.
 */
export class OidcClient {
  private readonly cache = new Map<string, CachedDiscovery>();
  private readonly pending = new Map<string, Promise<CachedDiscovery>>();

  constructor(private readonly providers: OidcProviderConfig[]) {}

  listProviders(): Array<{ id: string; label: string; issuer: string }> {
    return this.providers.map((provider) => ({
      id: provider.id,
      label: provider.label ?? provider.id,
      issuer: provider.issuer,
    }));
  }

  getProvider(id: string): OidcProviderConfig | undefined {
    return this.providers.find((provider) => provider.id === id);
  }

  async runtime(id: string): Promise<OidcRuntimeProvider> {
    const config = this.getProvider(id);
    if (!config) throw new Error(`unknown OIDC provider: ${id}`);
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
      return { config, discovery: cached.discovery, jwks: cached.jwks };
    }
    const inflight = this.pending.get(id);
    if (inflight) {
      const resolved = await inflight;
      return { config, discovery: resolved.discovery, jwks: resolved.jwks };
    }
    const promise = this.fetchDiscovery(config);
    this.pending.set(id, promise);
    try {
      const resolved = await promise;
      this.cache.set(id, resolved);
      return { config, discovery: resolved.discovery, jwks: resolved.jwks };
    } finally {
      this.pending.delete(id);
    }
  }

  private async fetchDiscovery(config: OidcProviderConfig): Promise<CachedDiscovery> {
    const url = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OIDC discovery failed for ${config.id}: HTTP ${response.status}`);
    }
    const discovery = discoverySchema.parse(await response.json());
    if (discovery.issuer.replace(/\/$/, "") !== config.issuer.replace(/\/$/, "")) {
      throw new Error(
        `OIDC discovery issuer mismatch for ${config.id}: ${discovery.issuer}`,
      );
    }
    return {
      discovery,
      jwks: createRemoteJWKSet(new URL(discovery.jwks_uri)),
      fetchedAt: Date.now(),
    };
  }

  async authorizationUrl(
    id: string,
    options: {
      redirectUri: string;
      state: string;
      nonce: string;
      codeChallenge: string;
    },
  ): Promise<string> {
    const { config, discovery } = await this.runtime(id);
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", options.redirectUri);
    url.searchParams.set("scope", config.scopes);
    url.searchParams.set("state", options.state);
    url.searchParams.set("nonce", options.nonce);
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(
    id: string,
    options: { code: string; redirectUri: string; codeVerifier: string },
  ): Promise<{ claims: Claims; idTokenClaims: Claims; accessToken: string | undefined }> {
    const { config, discovery, jwks } = await this.runtime(id);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: config.clientId,
      code_verifier: options.codeVerifier,
    });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);

    const response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OIDC token exchange failed for ${config.id}: HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OIDC token response was not JSON (${config.id})`);
    }
    const tokens = tokenResponseSchema.parse(parsed);
    if (!tokens.id_token) {
      throw new Error(`OIDC provider ${config.id} returned no id_token`);
    }

    const verified = await jwtVerify(tokens.id_token, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
      clockTolerance: 30,
    });
    const idTokenClaims = verified.payload as JWTPayload & Claims;

    let userinfoClaims: Claims = {};
    if (config.useUserinfo && tokens.access_token && discovery.userinfo_endpoint) {
      userinfoClaims = await this.fetchUserinfo(
        id,
        discovery.userinfo_endpoint,
        tokens.access_token,
      );
    }
    if (
      userinfoClaims.sub !== undefined &&
      idTokenClaims.sub !== undefined &&
      userinfoClaims.sub !== idTokenClaims.sub
    ) {
      throw new Error(`OIDC userinfo subject mismatch for ${config.id}`);
    }
    return {
      claims: { ...idTokenClaims, ...userinfoClaims },
      idTokenClaims,
      accessToken: tokens.access_token,
    };
  }

  private async fetchUserinfo(
    providerId: string,
    endpoint: string,
    accessToken: string,
  ): Promise<Claims> {
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OIDC userinfo failed for ${providerId}: HTTP ${response.status}`);
    }
    return (await response.json()) as Claims;
  }
}

/** PKCE S256: base64url(sha256(verifier)). */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: codeChallenge(verifier) };
}

export function createNonce(): string {
  return randomBytes(24).toString("base64url");
}
