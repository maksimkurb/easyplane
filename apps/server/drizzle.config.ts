import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.EASYPLANE_DATABASE_URL ??
      "postgres://easyplane:easyplane@127.0.0.1:5432/easyplane",
  },
  strict: true,
  verbose: true,
});
