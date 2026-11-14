import { createDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";

const url =
  process.env.EASYPLANE_DATABASE_URL ??
  "postgres://easyplane:easyplane@127.0.0.1:5432/easyplane";

const handle = createDatabase(url);
try {
  await runMigrations(handle.db);
  process.stdout.write("migrations applied\n");
} finally {
  await handle.close();
}
