import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Creates a Drizzle/Postgres handle. `pg.Pool` connects lazily, so building the
 * app (and generating the OpenAPI document) does not need a live database.
 */
export function createDatabase(
  connectionString: string,
  poolSize = 10,
): DatabaseHandle {
  const pool = new Pool({ connectionString, max: Math.max(1, poolSize) });
  const db = drizzle(pool, { schema }) as Database;
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
