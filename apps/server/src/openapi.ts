import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildApp } from "./app/build-app.js";
import { createAppContext } from "./app/context.js";
import * as schema from "./db/schema.js";
import { readEnv } from "./env.js";
import { createSilentLogger } from "./logger.js";

/**
 * Generates apps/server/openapi.json without touching the database. Orval and
 * the CI drift check consume that file.
 */
async function main(): Promise<void> {
  const env = readEnv({
    ...process.env,
    EASYPLANE_ENCRYPTION_KEY: "00".repeat(32),
    EASYPLANE_OIDC_PROVIDERS: "[]",
    EASYPLANE_WEB_DIR: "",
  });
  const pool = new Pool({ connectionString: env.databaseUrl, max: 1 });
  const db = drizzle(pool, { schema });
  const context = await createAppContext({
    env,
    db,
    pool,
    organisation: {
      id: "00000000-0000-4000-8000-000000000000",
      name: env.orgName,
      slug: env.orgSlug,
      createdAt: new Date(0),
    },
    logger: createSilentLogger(),
  });
  const app = await buildApp(context, { serveWeb: false });
  await app.ready();
  const document = (
    app as unknown as { swagger: () => Record<string, unknown> }
  ).swagger();
  const target = resolve(import.meta.dirname, "../openapi.json");
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`wrote ${target}\n`);
  await app.close();
  await pool.end();
}

await main();
