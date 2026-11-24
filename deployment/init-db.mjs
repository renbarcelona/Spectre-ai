import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(resolve("lib/db/package.json"));
const { Client } = require("pg");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"
  );
  if (rows[0].n !== 0) throw new Error("Database is not empty. Initialization refused; use the migration runbook.");
} finally {
  await client.end();
}
// The runtime enforces certificate verification. Preserve that for Drizzle's CLI.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set("sslmode", "verify-full");
const result = spawnSync("pnpm", ["--filter", "@workspace/db", "push"], {
  env: { ...process.env, DATABASE_URL: url.toString() },
  stdio: "inherit",
});
if (result.error) throw new Error("Could not start schema initialization.");
process.exit(result.status ?? 1);
