import { z } from "zod";

const oidcProviderSchema = z.object({
  /** Stable id used in URLs and identity rows. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, "provider id must match [a-z0-9_-]+"),
  label: z.string().min(1).optional(),
  issuer: z.string().url(),
  clientId: z.string().min(1),
  /** Omitted for public clients using PKCE only. */
  clientSecret: z.string().min(1).optional(),
  scopes: z.string().min(1).default("openid email profile"),
  /** Claim that carries groups/roles (array of strings or space/comma separated). */
  roleClaim: z.string().min(1).default("groups"),
  adminGroups: z.array(z.string()).default([]),
  memberGroups: z.array(z.string()).default([]),
  /** Role when no group matches. */
  defaultRole: z.enum(["admin", "member", "viewer"]).default("viewer"),
  emailClaim: z.string().min(1).default("email"),
  nameClaim: z.string().min(1).default("name"),
  /** Merge userinfo claims (some IdPs only expose groups there). */
  useUserinfo: z.boolean().default(true),
  allowedEmailDomains: z.array(z.string()).default([]),
});

export type OidcProviderConfig = z.infer<typeof oidcProviderSchema>;

const booleanish = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value === "") return undefined;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  EASYPLANE_DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://easyplane:easyplane@127.0.0.1:5432/easyplane"),
  /** 32-byte key, base64 or 64 hex chars. Required in production. */
  EASYPLANE_ENCRYPTION_KEY: z.string().optional(),
  EASYPLANE_HOST: z.string().default("0.0.0.0"),
  EASYPLANE_HTTP_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  EASYPLANE_TCP_PORT: z.coerce.number().int().min(0).max(65535).default(22020),
  EASYPLANE_WS_PORT: z.coerce.number().int().min(0).max(65535).default(22023),
  EASYPLANE_WSS_PORT: z.coerce.number().int().min(0).max(65535).optional(),
  EASYPLANE_TLS_CERT: z.string().optional(),
  EASYPLANE_TLS_KEY: z.string().optional(),
  /** Set to `off` to advertise no web-secure support (debug only). */
  EASYPLANE_SECURE: z.string().default("on"),
  /**
   * Public origin of the panel, e.g. https://easyplane.example.com. Used for
   * OIDC redirect URIs and the invite command. Defaults to the request origin.
   */
  EASYPLANE_PUBLIC_URL: z.string().url().optional(),
  /** Public config-server base used in invite commands, e.g. wss://vpn.example.com. */
  EASYPLANE_PUBLIC_CONFIG_SERVER_URL: z.string().url().optional(),
  EASYPLANE_TRUST_PROXY: booleanish,
  EASYPLANE_SECURE_COOKIES: booleanish,
  EASYPLANE_OIDC_PROVIDERS: z.string().default("[]"),
  /** Comma-separated legacy allow-list for M0 tests; M1 uses invites. */
  EASYPLANE_TOKENS: z.string().default(""),
  EASYPLANE_BOOTSTRAP_ADMIN_TOKEN: z.string().optional(),
  /** Re-enable the bootstrap token after an admin already exists. */
  EASYPLANE_BOOTSTRAP_REENABLE: booleanish,
  EASYPLANE_ORG_NAME: z.string().default("EasyPlane"),
  EASYPLANE_ORG_SLUG: z.string().default("default"),
  EASYPLANE_SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(720),
  EASYPLANE_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(168),
  EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  EASYPLANE_RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  EASYPLANE_MAX_PENDING_DEVICES_PER_NETWORK: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
  EASYPLANE_WEB_DIR: z.string().optional(),
  EASYPLANE_LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
});

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  encryptionKey: string;
  host: string;
  httpPort: number;
  tcpPort: number;
  wsPort: number;
  wss: { port: number; certFile: string; keyFile: string } | null;
  supportEncryption: boolean;
  publicUrl: string | undefined;
  publicConfigServerUrl: string | undefined;
  trustProxy: boolean;
  secureCookies: boolean;
  oidcProviders: OidcProviderConfig[];
  legacyTokens: string[];
  bootstrapAdminToken: string | undefined;
  bootstrapReenable: boolean;
  orgName: string;
  orgSlug: string;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  deviceOnlineTimeoutMs: number;
  reconcileIntervalMs: number;
  unknownTokenLimitPerMinute: number;
  maxPendingDevicesPerNetwork: number;
  webDir: string | undefined;
  logLevel: string;
}

function parseProviderList(raw: string): OidcProviderConfig[] {
  if (raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `EASYPLANE_OIDC_PROVIDERS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const list = z.array(oidcProviderSchema).parse(parsed);
  const ids = new Set<string>();
  for (const provider of list) {
    if (ids.has(provider.id)) {
      throw new Error(`duplicate OIDC provider id: ${provider.id}`);
    }
    ids.add(provider.id);
  }
  return list;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(source);
  const encryptionKey = parsed.EASYPLANE_ENCRYPTION_KEY ?? "";
  if (encryptionKey === "" && parsed.NODE_ENV === "production") {
    throw new Error("EASYPLANE_ENCRYPTION_KEY is required in production");
  }
  const wssPort = parsed.EASYPLANE_WSS_PORT;
  if (wssPort !== undefined) {
    if (!parsed.EASYPLANE_TLS_CERT || !parsed.EASYPLANE_TLS_KEY) {
      throw new Error(
        "EASYPLANE_WSS_PORT requires EASYPLANE_TLS_CERT and EASYPLANE_TLS_KEY",
      );
    }
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.EASYPLANE_DATABASE_URL,
    encryptionKey,
    host: parsed.EASYPLANE_HOST,
    httpPort: parsed.EASYPLANE_HTTP_PORT,
    tcpPort: parsed.EASYPLANE_TCP_PORT,
    wsPort: parsed.EASYPLANE_WS_PORT,
    wss:
      wssPort !== undefined && parsed.EASYPLANE_TLS_CERT && parsed.EASYPLANE_TLS_KEY
        ? {
            port: wssPort,
            certFile: parsed.EASYPLANE_TLS_CERT,
            keyFile: parsed.EASYPLANE_TLS_KEY,
          }
        : null,
    supportEncryption: parsed.EASYPLANE_SECURE.toLowerCase() !== "off",
    publicUrl: parsed.EASYPLANE_PUBLIC_URL?.replace(/\/$/, ""),
    publicConfigServerUrl: parsed.EASYPLANE_PUBLIC_CONFIG_SERVER_URL?.replace(
      /\/$/,
      "",
    ),
    trustProxy: parsed.EASYPLANE_TRUST_PROXY ?? parsed.NODE_ENV === "production",
    secureCookies:
      parsed.EASYPLANE_SECURE_COOKIES ?? parsed.NODE_ENV === "production",
    oidcProviders: parseProviderList(parsed.EASYPLANE_OIDC_PROVIDERS),
    legacyTokens: parsed.EASYPLANE_TOKENS.split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0),
    bootstrapAdminToken: parsed.EASYPLANE_BOOTSTRAP_ADMIN_TOKEN,
    bootstrapReenable: parsed.EASYPLANE_BOOTSTRAP_REENABLE ?? false,
    orgName: parsed.EASYPLANE_ORG_NAME,
    orgSlug: parsed.EASYPLANE_ORG_SLUG,
    sessionIdleMs: parsed.EASYPLANE_SESSION_IDLE_MINUTES * 60_000,
    sessionAbsoluteMs: parsed.EASYPLANE_SESSION_ABSOLUTE_HOURS * 3_600_000,
    deviceOnlineTimeoutMs: parsed.EASYPLANE_DEVICE_ONLINE_TIMEOUT_MS,
    reconcileIntervalMs: parsed.EASYPLANE_RECONCILE_INTERVAL_MS,
    unknownTokenLimitPerMinute: parsed.EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE,
    maxPendingDevicesPerNetwork:
      parsed.EASYPLANE_MAX_PENDING_DEVICES_PER_NETWORK,
    webDir: parsed.EASYPLANE_WEB_DIR,
    logLevel: parsed.EASYPLANE_LOG_LEVEL,
  };
}
