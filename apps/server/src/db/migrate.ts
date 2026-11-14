import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { Database } from "./client.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Applies every pending migration from apps/server/drizzle. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
