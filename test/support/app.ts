import type { FastifyInstance } from "fastify";

import {
  buildApp,
  createAppContext,
  readEnv,
  type AppContext,
  type AppEnv,
} from "@easyplane/server";
import { createSilentLogger } from "@easyplane/server";

import { createTestDatabase, type TestDatabase } from "./database.js";
import { MOCK_USERS, startMockIdp, type MockIdp } from "./mock-oidc.js";

export const TEST_HOST = "127.0.0.1:8080";
export const BOOTSTRAP_TOKEN = "test-bootstrap-token";

export interface TestApp {
  app: FastifyInstance;
  context: AppContext;
  env: AppEnv;
  database: TestDatabase;
  idp: MockIdp | null;
  stop: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /** Enable the mock OIDC provider (default true). */
  oidc?: boolean;
  /** `allowedEmailDomains` for the provider. */
  allowedEmailDomains?: string[];
  /** Extra env values (strings). */
  env?: Record<string, string>;
  /** Reuse an existing DB (for multi-app tests). */
  database?: TestDatabase;
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestApp> {
  const idp = options.oidc === false ? null : await startMockIdp();
  const database = options.database ?? (await createTestDatabase());
  const provider = idp
    ? [
        {
          id: "mock",
          label: "Mock SSO",
          issuer: idp.issuer,
          clientId: "easyplane-test",
          clientSecret: "test-secret",
          scopes: "openid email profile",
          roleClaim: "groups",
          adminGroups: ["easyplane-admins"],
          memberGroups: ["easyplane-members"],
          defaultRole: "viewer",
          allowedEmailDomains: options.allowedEmailDomains ?? [],
        },
      ]
    : [];

  const env = readEnv({
    ...process.env,
    NODE_ENV: "test",
    EASYPLANE_DATABASE_URL: database.url,
    EASYPLANE_ENCRYPTION_KEY: "ab".repeat(32),
    EASYPLANE_HOST: "127.0.0.1",
    EASYPLANE_HTTP_PORT: "0",
    EASYPLANE_TCP_PORT: "0",
    EASYPLANE_WS_PORT: "0",
    EASYPLANE_SECURE_COOKIES: "false",
    EASYPLANE_TRUST_PROXY: "false",
    EASYPLANE_OIDC_PROVIDERS: JSON.stringify(provider),
    EASYPLANE_BOOTSTRAP_ADMIN_TOKEN: BOOTSTRAP_TOKEN,
    EASYPLANE_BOOTSTRAP_REENABLE: "",
    EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: "2000",
    EASYPLANE_TOKENS: "",
    EASYPLANE_LOG_LEVEL: "silent",
    EASYPLANE_WEB_DIR: "",
    ...options.env,
  });

  const context = await createAppContext({
    env,
    db: database.db,
    pool: database.pool,
    logger: createSilentLogger(),
  });
  const app = await buildApp(context, { serveWeb: false });
  await app.ready();

  return {
    app,
    context,
    env,
    database,
    idp,
    stop: async () => {
      await app.close();
      await context.push.stop();
      if (!options.database) await database.drop();
      if (idp) await idp.stop();
    },
  };
}

export interface LoginResult {
  statusCode: number;
  cookie: string;
  csrfToken: string;
  userId: string;
  role: string;
}

/**
 * Drives the real authorization-code + PKCE flow through the mock IdP exactly
 * like a browser would, using Fastify injection for the panel endpoints.
 */
export async function loginWithMockIdp(
  test: TestApp,
  user: keyof typeof MOCK_USERS,
  options: { providerId?: string } = {},
): Promise<LoginResult> {
  const providerId = options.providerId ?? "mock";
  const login = await test.app.inject({
    method: "GET",
    url: `/api/auth/login/${providerId}`,
    headers: { host: TEST_HOST },
  });
  if (login.statusCode !== 302) {
    throw new Error(`login start failed: ${login.statusCode} ${login.body}`);
  }
  const authorizeUrl = new URL(login.headers.location as string);
  authorizeUrl.searchParams.set("login_hint", user);
  const authorize = await fetch(authorizeUrl, { redirect: "manual" });
  const callbackLocation = authorize.headers.get("location");
  if (authorize.status !== 302 || !callbackLocation) {
    throw new Error(`mock IdP authorize failed: ${authorize.status}`);
  }
  const callbackUrl = new URL(callbackLocation);
  const callback = await test.app.inject({
    method: "GET",
    url: `${callbackUrl.pathname}${callbackUrl.search}`,
    headers: { host: TEST_HOST },
  });
  if (callback.statusCode !== 302) {
    throw new Error(`callback failed: ${callback.statusCode} ${callback.body}`);
  }
  const cookies = callback.cookies as Array<{ name: string; value: string }>;
  const session = cookies.find((cookie) => cookie.name === "easyplane_session");
  const csrf = cookies.find((cookie) => cookie.name === "easyplane_csrf");
  if (!session || !csrf) throw new Error("callback did not set session cookies");

  const me = await test.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { host: TEST_HOST, cookie: `easyplane_session=${session.value}` },
  });
  if (me.statusCode !== 200) throw new Error(`/me failed: ${me.statusCode}`);
  const body = me.json() as {
    user: { id: string; role: string };
    csrfToken: string;
  };
  return {
    statusCode: callback.statusCode,
    cookie: `easyplane_session=${session.value}; easyplane_csrf=${csrf.value}`,
    csrfToken: body.csrfToken,
    userId: body.user.id,
    role: body.user.role,
  };
}

export function sessionCookie(login: LoginResult): string {
  return login.cookie.split(";")[0]!;
}

export function authed(login: LoginResult, extra: Record<string, string> = {}) {
  return {
    host: TEST_HOST,
    cookie: sessionCookie(login),
    ...extra,
  };
}

export const ADMIN = MOCK_USERS.admin;
