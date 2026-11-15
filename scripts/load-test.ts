/**
 * Load test with simulated config-server clients.
 *
 *   bun run test:load                        # 200 clients over ws
 *   EASYPLANE_LOAD_CLIENTS=500 EASYPLANE_LOAD_TRANSPORT=udp bun run test:load
 *
 * The clients are `test/support/protocol-client.ts`: real tunnel framing, the
 * Noise handshake, AES-GCM epochs, RPC piece reassembly and the real
 * WebClientService methods. The server, database, enrollment, approval,
 * desired-state push and heartbeat reaper are the production code paths.
 *
 * Requires PostgreSQL (the same throwaway container as the integration suite).
 */
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import {
  buildApp,
  createAppContext,
  readEnv,
  schema,
  type AppContext,
} from "@easyplane/server";

import { createTestDatabase, type TestDatabase } from "../test/support/database.js";
import {
  SimulatedClient,
  percentile,
} from "../test/support/protocol-client.js";

const CLIENTS = Number(process.env.EASYPLANE_LOAD_CLIENTS ?? 200);
const TRANSPORT = (process.env.EASYPLANE_LOAD_TRANSPORT ?? "ws") as
  | "ws"
  | "tcp"
  | "udp";
const WARMUP_MS = Number(process.env.EASYPLANE_LOAD_WARMUP_MS ?? 3_000);
function logPhase(message: string): void {
  process.stderr.write(`[load] ${message}\n`);
}

const CONVERGE_TIMEOUT_MS = Number(
  process.env.EASYPLANE_LOAD_CONVERGE_TIMEOUT_MS ?? 180_000,
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;
}

async function main(): Promise<void> {
  if (!Number.isFinite(CLIENTS) || CLIENTS < 1) {
    throw new Error("EASYPLANE_LOAD_CLIENTS must be a positive number");
  }
  const basePort = 30_000 + (process.pid % 1_000) * 2;
  const port = basePort + 1;

  const database: TestDatabase = await createTestDatabase();
  const env = readEnv({
    ...process.env,
    NODE_ENV: "test",
    EASYPLANE_DATABASE_URL: database.url,
    EASYPLANE_DATABASE_POOL_SIZE: process.env.EASYPLANE_LOAD_POOL_SIZE ?? "20",
    EASYPLANE_ENCRYPTION_KEY: "ab".repeat(32),
    EASYPLANE_HOST: "127.0.0.1",
    EASYPLANE_HTTP_PORT: "0",
    EASYPLANE_TCP_PORT: TRANSPORT === "tcp" ? String(port) : "0",
    EASYPLANE_WS_PORT: TRANSPORT === "ws" ? String(port) : "0",
    EASYPLANE_UDP_PORT: TRANSPORT === "udp" ? String(port) : "",
    EASYPLANE_LOG_LEVEL: process.env.EASYPLANE_LOAD_LOG_LEVEL ?? "warn",
    EASYPLANE_TRUST_PROXY: "false",
    EASYPLANE_SECURE_COOKIES: "false",
    EASYPLANE_MAX_CLIENT_CONNECTIONS: String(CLIENTS + 100),
    EASYPLANE_CLIENT_ACCEPT_LIMIT_PER_MINUTE: String(CLIENTS * 10),
    EASYPLANE_CLIENT_HEARTBEAT_TIMEOUT_MS: "90000",
    EASYPLANE_MAX_PENDING_DEVICES_PER_NETWORK: String(CLIENTS + 100),
    EASYPLANE_RECONCILE_INTERVAL_MS: "30000",
    EASYPLANE_ROUTE_REPORT_INTERVAL_MS: "120000",
    EASYPLANE_SSE_MAX_TOTAL: "100",
  });

  const context: AppContext = await createAppContext({
    env,
    db: database.db,
    pool: database.pool,
  });
  const app = await buildApp(context, { serveWeb: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addresses = await context.controlPlane.start();
  context.push.start(env.reconcileIntervalMs);

  const [user] = await database.db
    .insert(schema.users)
    .values({
      orgId: context.organisation.id,
      email: `load-${Date.now()}@example.test`,
      displayName: "Load test",
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("failed to create the load-test user");

  const network = await context.networks.create({
    orgId: context.organisation.id,
    userId: user.id,
    name: "Load test",
    ipv4Cidr: "10.200.0.0/16",
    defaultConfig: { noTun: true },
  });
  const invite = await context.invites.create({
    orgId: context.organisation.id,
    networkId: network.id,
    userId: user.id,
    label: "load",
    expiresInHours: 1,
    maxUses: CLIENTS,
  });

  const scheme =
    TRANSPORT === "ws" ? "ws" : TRANSPORT;
  const url = `${scheme}://127.0.0.1:${addresses[`${TRANSPORT}Port` as const] ?? port}/${invite.token}`;

  logPhase(`server listening: http=${JSON.stringify(app.server.address())} control=${JSON.stringify(addresses)}`);
  const rssBefore = rssMb();
  const cpuBefore = process.cpuUsage();
  const startedAt = performance.now();

  const clients: SimulatedClient[] = [];
  const connectFailures: string[] = [];
  await Promise.all(
    Array.from({ length: CLIENTS }, async (_value, index) => {
      const machineId = randomUUID();
      const client = new SimulatedClient({
        url,
        token: invite.token,
        machineId,
        hostname: `load-${String(index).padStart(3, "0")}`,
        heartbeatIntervalMs: 1_000,
      });
      clients.push(client);
      try {
        await client.connect();
      } catch (error) {
        connectFailures.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );
  logPhase(`connect phase: ${CLIENTS} clients in ${((performance.now() - startedAt) / 1000).toFixed(2)}s (${connectFailures.length} failures)`);
  if (connectFailures.length > 0) {
    throw new Error(
      `${connectFailures.length} clients failed to connect: ${connectFailures.slice(0, 5).join("; ")}`,
    );
  }

  const connectedAt = performance.now();
  // Wait until the server has enrolled every client (pending is fine).
  const enrollDeadline = Date.now() + 120_000;
  let pending = 0;
  for (;;) {
    pending = (await database.db.query.devices.findMany()).filter(
      (device) => device.networkId === network.id,
    ).length;
    if (pending >= CLIENTS) break;
    if (Date.now() > enrollDeadline) {
      throw new Error(`only ${pending}/${CLIENTS} devices enrolled`);
    }
    await sleep(100);
  }
  const enrolledAt = performance.now();
  logPhase(`enrolled ${pending}/${CLIENTS} in ${((enrolledAt - startedAt) / 1000).toFixed(2)}s`);

  // Approve in batches; each approval creates a revision and schedules a push.
  const devices = await database.db.query.devices.findMany();
  const approveStarted = performance.now();
  const batchSize = 25;
  for (let offset = 0; offset < devices.length; offset += batchSize) {
    const batchStarted = performance.now();
    logPhase(`approve batch ${offset / batchSize + 1}/${Math.ceil(devices.length / batchSize)}`);
    await Promise.all(
      devices.slice(offset, offset + batchSize).map((device) =>
        context.devices.approve(
          { orgId: context.organisation.id, userId: user.id, role: "admin" },
          device.id,
        ),
      ),
    );
    logPhase(`approve batch done in ${((performance.now() - batchStarted) / 1000).toFixed(2)}s`);
  }
  const approvedAt = performance.now();
  logPhase(`approved ${devices.length} devices in ${((approvedAt - approveStarted) / 1000).toFixed(2)}s`);

  // Wait for the desired-state engine to report every device applied.
  const convergeDeadline = Date.now() + CONVERGE_TIMEOUT_MS;
  let applied = 0;
  for (;;) {
    const rows = await database.db.query.devices.findMany();
    applied = rows.filter(
      (device) => device.appliedRevision !== null && device.lastPushError === null,
    ).length;
    if (applied >= CLIENTS) break;
    if (Date.now() > convergeDeadline) break;
    await sleep(250);
  }
  const convergedAt = performance.now();
  logPhase(`converged ${applied}/${CLIENTS} in ${((convergedAt - approvedAt) / 1000).toFixed(2)}s`);

  // Let heartbeats run at steady state, then sample latency.
  await sleep(WARMUP_MS);
  const heartbeatSamples = clients.flatMap((client) =>
    client.stats.heartbeatLatenciesMs.slice(1),
  );
  const heartbeatsSent = clients.reduce(
    (total, client) => total + client.stats.heartbeatsSent,
    0,
  );
  const heartbeatFailures = clients.reduce(
    (total, client) => total + client.stats.heartbeatFailures,
    0,
  );
  const runRequests = clients.reduce(
    (total, client) => total + client.stats.runRequests,
    0,
  );
  const rssAfter = rssMb();
  const cpuAfter = process.cpuUsage(cpuBefore);

  const auditRows = await database.db.query.auditLog.findMany();
  const pushAudits = auditRows.filter(
    (row) => row.action === "device.config.pushed",
  ).length;
  const deviceRows = await database.db.query.devices.findMany();
  const revisionRows = await database.db.query.configRevisions.findMany();

  const result = {
    clients: CLIENTS,
    transport: TRANSPORT,
    secure: true,
    connectSeconds: Number(((connectedAt - startedAt) / 1000).toFixed(2)),
    connectRatePerSecond: Number(
      (CLIENTS / ((connectedAt - startedAt) / 1000)).toFixed(1),
    ),
    enrollSeconds: Number(((enrolledAt - startedAt) / 1000).toFixed(2)),
    approveSeconds: Number(((approvedAt - approveStarted) / 1000).toFixed(2)),
    convergeSeconds: Number(((convergedAt - approvedAt) / 1000).toFixed(2)),
    applied: `${applied}/${CLIENTS}`,
    pushes: pushAudits,
    runRequests,
    heartbeatsSent,
    heartbeatFailures,
    heartbeatLatencyMs: {
      p50: percentile(heartbeatSamples, 0.5),
      p95: percentile(heartbeatSamples, 0.95),
      p99: percentile(heartbeatSamples, 0.99),
      max: heartbeatSamples.length > 0 ? Math.max(...heartbeatSamples) : 0,
    },
    rssMbBefore: rssBefore,
    rssMbAfter: rssAfter,
    rssMbPerClient: Number(((rssAfter - rssBefore) / CLIENTS).toFixed(2)),
    serverCpuSeconds: Number(
      ((cpuAfter.user + cpuAfter.system) / 1_000_000).toFixed(2),
    ),
    devices: deviceRows.length,
    revisions: revisionRows.length,
    audits: auditRows.length,
    durationSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(2)),
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  for (const client of clients) client.close();
  await sleep(250);
  await context.push.stop();
  await app.close();
  await context.controlPlane.stop();
  await database.drop();
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
