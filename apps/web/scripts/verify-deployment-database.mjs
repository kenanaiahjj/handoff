import { Client } from "pg";

if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
  console.log("Skipping the production database preflight outside Vercel Production.");
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Database preflight failed: DATABASE_URL is missing.");
  process.exit(1);
}

try {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("unsupported protocol");
  }
} catch {
  console.error("Database preflight failed: DATABASE_URL is not a PostgreSQL URL.");
  process.exit(1);
}

const hostname = new URL(connectionString).hostname.toLowerCase();
const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
const supabaseCa = process.env.SUPABASE_DB_SSL_CA?.trim();
const client = new Client({
  connectionString,
  connectionTimeoutMillis: 10000,
  ssl: isLocal ? false : { rejectUnauthorized: true, ...(supabaseCa ? { ca: supabaseCa } : {}) },
});

try {
  await client.connect();
  const result = await client.query(`
    select
      to_regclass('public."user"') is not null as has_user,
      to_regclass('public.session') is not null as has_session,
      to_regclass('public.workspace_membership') is not null as has_workspace_membership
  `);
  const schema = result.rows[0];
  if (!schema.has_user || !schema.has_session || !schema.has_workspace_membership) {
    console.error("Database preflight failed: connected, but expected app tables are missing.");
    process.exitCode = 1;
  } else {
    console.log("Database preflight passed: connected and expected app tables are present.");
  }
} catch (error) {
  console.error(`Database preflight failed: ${error.code || error.name || "connection error"}.`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
