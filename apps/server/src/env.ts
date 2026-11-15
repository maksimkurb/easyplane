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
  /** UDP config-server transport; unset/0 disables it. */
  EASYPLANE_UDP_PORT: z.coerce.number().int().min(0).max(65535).optional(),
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
  /** Minimum gap between route reports per device (CollectNetworkInfo). */
  EASYPLANE_ROUTE_REPORT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(30_000),
  /**
   * M3 topology collection. The idle interval applies when no browser has the
   * map open; the active interval only while at least one SSE stream watches
   * the topology. Both get jitter.
   */
  EASYPLANE_TOPOLOGY_IDLE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  EASYPLANE_TOPOLOGY_ACTIVE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
  EASYPLANE_TOPOLOGY_JITTER: z.coerce.number().min(0).max(0.9).default(0.2),
  EASYPLANE_TOPOLOGY_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .max(64)
    .default(4),
  EASYPLANE_TOPOLOGY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .default(5_000),
  EASYPLANE_TOPOLOGY_MAX_DEVICES: z.coerce
    .number()
    .int()
    .positive()
    .default(500),
  /** Bounded concurrent browser event streams. */
  EASYPLANE_SSE_MAX_PER_USER: z.coerce.number().int().positive().max(32).default(4),
  EASYPLANE_SSE_MAX_TOTAL: z.coerce.number().int().positive().default(500),
  EASYPLANE_SSE_EVENT_BUFFER: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(500),
  EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  /** Hard cap on simultaneous config-server tunnels (0 disables the cap). */
  EASYPLANE_MAX_CLIENT_CONNECTIONS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(2_000),
  /** Per-IP tunnel admission limit per minute (0 disables). */
  EASYPLANE_CLIENT_ACCEPT_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(600),
  /** Close a tunnel that sent no heartbeat for this long (0 disables). */
  EASYPLANE_CLIENT_HEARTBEAT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(20_000),
  /** Blanket HTTP API rate limit per client IP; auth/import add stricter ones. */
  EASYPLANE_API_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(600),
  /**
   * Optional Prometheus scrape token. `/metrics` is disabled unless set; the
   * token is compared in constant time and no secret is ever exposed there.
   */
  EASYPLANE_METRICS_TOKEN: z.string().min(16).optional(),
  /** Optional internal-only metrics listener (no auth); 0/undefined disables. */
  EASYPLANE_METRICS_PORT: z.coerce.number().int().min(0).max(65535).optional(),
  EASYPLANE_METRICS_HOST: z.string().default("127.0.0.1"),
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
  udpPort: number | null;
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
  routeReportIntervalMs: number;
  topologyIdleIntervalMs: number;
  topologyActiveIntervalMs: number;
  topologyJitterRatio: number;
  topologyConcurrency: number;
  topologyTimeoutMs: number;
  topologyMaxDevices: number;
  sseMaxPerUser: number;
  sseMaxTotal: number;
  sseEventBuffer: number;
  unknownTokenLimitPerMinute: number;
  maxClientConnections: number;
  clientAcceptLimitPerMinute: number;
  clientHeartbeatTimeoutMs: number;
  apiRateLimitPerMinute: number;
  metricsToken: string | undefined;
  metricsPort: number | undefined;
  metricsHost: string;
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
    udpPort:
      parsed.EASYPLANE_UDP_PORT !== undefined && parsed.EASYPLANE_UDP_PORT > 0
        ? parsed.EASYPLANE_UDP_PORT
        : null,
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
    routeReportIntervalMs: parsed.EASYPLANE_ROUTE_REPORT_INTERVAL_MS,
    topologyIdleIntervalMs: parsed.EASYPLANE_TOPOLOGY_IDLE_INTERVAL_MS,
    topologyActiveIntervalMs: parsed.EASYPLANE_TOPOLOGY_ACTIVE_INTERVAL_MS,
    topologyJitterRatio: parsed.EASYPLANE_TOPOLOGY_JITTER,
    topologyConcurrency: parsed.EASYPLANE_TOPOLOGY_CONCURRENCY,
    topologyTimeoutMs: parsed.EASYPLANE_TOPOLOGY_TIMEOUT_MS,
    topologyMaxDevices: parsed.EASYPLANE_TOPOLOGY_MAX_DEVICES,
    sseMaxPerUser: parsed.EASYPLANE_SSE_MAX_PER_USER,
    sseMaxTotal: parsed.EASYPLANE_SSE_MAX_TOTAL,
    sseEventBuffer: parsed.EASYPLANE_SSE_EVENT_BUFFER,
    unknownTokenLimitPerMinute: parsed.EASYPLANE_UNKNOWN_TOKEN_LIMIT_PER_MINUTE,
    maxClientConnections: parsed.EASYPLANE_MAX_CLIENT_CONNECTIONS,
    clientAcceptLimitPerMinute: parsed.EASYPLANE_CLIENT_ACCEPT_LIMIT_PER_MINUTE,
    clientHeartbeatTimeoutMs: parsed.EASYPLANE_CLIENT_HEARTBEAT_TIMEOUT_MS,
    apiRateLimitPerMinute: parsed.EASYPLANE_API_RATE_LIMIT_PER_MINUTE,
    metricsToken: parsed.EASYPLANE_METRICS_TOKEN,
    metricsPort: parsed.EASYPLANE_METRICS_PORT,
    metricsHost: parsed.EASYPLANE_METRICS_HOST,
    maxPendingDevicesPerNetwork:
      parsed.EASYPLANE_MAX_PENDING_DEVICES_PER_NETWORK,
    webDir: parsed.EASYPLANE_WEB_DIR,
    logLevel: parsed.EASYPLANE_LOG_LEVEL,
  };
}
