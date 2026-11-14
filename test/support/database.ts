import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { Pool } from "pg";

import {
  createDatabase,
  runMigrations,
  type Database,
} from "@easyplane/server";

export const TEST_PG_CONTAINER = "easyplane-test-postgres";
export const TEST_PG_PORT = 22090;

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts (or reuses) the throwaway Postgres used by the test suites. */
export async function ensureTestPostgres(): Promise<void> {
  if (!dockerAvailable()) {
    throw new Error(
      "docker is not available; integration and conformance tests need Postgres (or set EASYPLANE_TEST_DATABASE_URL)",
    );
  }
  const running = spawnSync(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", TEST_PG_CONTAINER],
    { encoding: "utf8" },
  );
  if (running.status === 0 && running.stdout.trim() === "true") return;

  spawnSync("docker", ["rm", "-f", TEST_PG_CONTAINER], { stdio: "ignore" });
  const created = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      TEST_PG_CONTAINER,
      "-e",
      "POSTGRES_USER=easyplane",
      "-e",
      "POSTGRES_PASSWORD=easyplane",
      "-e",
      "POSTGRES_DB=easyplane",
      "-p",
      `${TEST_PG_PORT}:5432`,
      "postgres:17-alpine",
    ],
    { encoding: "utf8" },
  );
  if (created.status !== 0) {
    throw new Error(`failed to start Postgres: ${created.stderr}`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = spawnSync(
      "docker",
      ["exec", TEST_PG_CONTAINER, "pg_isready", "-U", "easyplane"],
      { stdio: "ignore" },
    );
    if (ready.status === 0) return;
    await sleep(500);
  }
  throw new Error("Postgres did not become ready");
}

export function testDatabaseUrl(database: string): string {
  return (
    process.env.EASYPLANE_TEST_DATABASE_URL ??
    `postgres://easyplane:easyplane@127.0.0.1:${TEST_PG_PORT}/${database}`
  );
}

export interface TestDatabase {
  url: string;
  database: string;
  handle: ReturnType<typeof createDatabase>;
  db: Database;
  pool: Pool;
  drop: () => Promise<void>;
}

let counter = 0;

/** Creates an isolated, migrated database for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  await ensureTestPostgres();
  counter += 1;
  const database = `easyplane_test_${process.pid}_${counter}_${randomBytes(2).toString("hex")}`;
  const adminUrl = testDatabaseUrl("easyplane");
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  const url = testDatabaseUrl(database);
  const handle = createDatabase(url);
  await runMigrations(handle.db);
  return {
    url,
    database,
    handle,
    db: handle.db,
    pool: handle.pool,
    drop: async () => {
      await handle.close();
      const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
