import { pruneOidcLoginStates, pruneSessions } from "./db/repositories.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { readEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { buildApp } from "./app/build-app.js";
import { createAppContext } from "./app/context.js";
import { startInternalMetricsServer } from "./observability/metrics-server.js";

async function main(): Promise<void> {
  const env = readEnv();
  const logger = createLogger({
    level: env.logLevel as "debug" | "info" | "warn" | "error",
  });

  if (env.encryptionKey === "") {
    logger.warn(
      "EASYPLANE_ENCRYPTION_KEY is empty: using an insecure development key. Set a 32-byte key before storing real networks.",
    );
  }
  if (env.oidcProviders.length === 0) {
    logger.warn(
      "no OIDC providers configured (EASYPLANE_OIDC_PROVIDERS): only the break-glass bootstrap token can sign in",
    );
  }

  const database = createDatabase(env.databaseUrl);
  await runMigrations(database.db);
  const context = await createAppContext({
    env,
    db: database.db,
    pool: database.pool,
    logger,
  });
  const app = await buildApp(context);

  const addresses = await context.controlPlane.start();
  await app.listen({ host: env.host, port: env.httpPort });
  context.push.start(env.reconcileIntervalMs);
  context.topology.start();
  const metricsServer =
    env.metricsPort !== undefined && env.metricsPort > 0
      ? await startInternalMetricsServer(context, env.metricsHost, env.metricsPort)
      : null;
  if (env.metricsPort !== undefined && env.metricsPort > 0) {
    logger.info("internal metrics listener started", {
      host: env.metricsHost,
      port: env.metricsPort,
    });
  }
  if (!env.metricsToken && !metricsServer) {
    logger.info("metrics endpoint disabled", {
      hint: "set EASYPLANE_METRICS_TOKEN or EASYPLANE_METRICS_PORT to enable",
    });
  }

  const housekeeping = setInterval(() => {
    const now = new Date();
    void pruneSessions(database.db, now).catch(() => undefined);
    void pruneOidcLoginStates(database.db, now).catch(() => undefined);
  }, 3_600_000);
  housekeeping.unref?.();

  logger.info("easyplane listening", {
    http: env.httpPort,
    ws: addresses.wsPort,
    tcp: addresses.tcpPort,
    udp: addresses.udpPort,
    wss: addresses.wssPort,
    organisation: context.organisation.slug,
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("shutting down", { signal });
    clearInterval(housekeeping);
    if (metricsServer) await metricsServer.close();
    await context.topology.stop();
    await context.push.stop();
    await app.close();
    await context.controlPlane.stop();
    await database.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "fatal",
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
