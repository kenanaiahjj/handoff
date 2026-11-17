import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_TABLE_ORDER,
  checkObject,
  collectObjectManifest,
  countTargetRows,
  createPostgresPool,
  createSupabaseStorage,
  inspectLocalObjects,
  openReadonlySqlite,
  quoteIdentifier,
  readTargetSchema,
  sqliteTableNames,
} from "./migrate-sqlite-to-supabase.mjs";

function objectMetadataEqual(left, right) {
  return left.contentType === right.contentType
    && Number(left.sizeBytes) === Number(right.sizeBytes)
    && left.sha256.toLowerCase() === right.sha256.toLowerCase();
}

async function getTargetObjectManifest(pool) {
  const result = await pool.query(
    `SELECT object_key, content_type, size_bytes::text AS size_bytes, sha256
     FROM handoff_asset ORDER BY object_key, id`,
  );
  const objects = new Map();
  const issues = [];
  for (const row of result.rows) {
    const entry = {
      objectKey: row.object_key,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256,
    };
    const previous = objects.get(entry.objectKey);
    if (previous && !objectMetadataEqual(previous, entry)) {
      issues.push({ kind: "conflicting-target-asset-metadata", objectKey: entry.objectKey });
    } else {
      objects.set(entry.objectKey, entry);
    }
  }
  return { objects, issues };
}

async function inspectForeignKeys(pool) {
  const unvalidated = await pool.query(
    `SELECT conname, conrelid::regclass::text AS table_name
     FROM pg_constraint
     JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
     WHERE contype = 'f' AND pg_namespace.nspname = 'public' AND NOT convalidated
     ORDER BY conrelid::regclass::text, conname`,
  );
  const publishedVersions = await pool.query(
    `SELECT handoff.id, handoff.published_version_id, handoff_version.handoff_id AS version_handoff_id
     FROM handoff
     LEFT JOIN handoff_version ON handoff_version.id = handoff.published_version_id
     WHERE handoff.published_version_id IS NOT NULL
       AND (handoff_version.id IS NULL OR handoff_version.handoff_id <> handoff.id)`,
  );
  const snapshotReferences = await pool.query(
    `SELECT handoff_version_snapshot.version_id
     FROM handoff_version_snapshot
     LEFT JOIN handoff_version ON handoff_version.id = handoff_version_snapshot.version_id
     WHERE handoff_version.id IS NULL`,
  );
  const versionReferences = await pool.query(
    `SELECT handoff_version.id
     FROM handoff_version
     LEFT JOIN handoff ON handoff.id = handoff_version.handoff_id
     WHERE handoff.id IS NULL OR handoff.workspace_id <> handoff_version.workspace_id`,
  );

  return {
    unvalidatedConstraints: unvalidated.rows,
    publishedVersionMismatches: publishedVersions.rows,
    missingSnapshotVersions: snapshotReferences.rows.map((row) => row.version_id),
    missingHandoffVersions: versionReferences.rows.map((row) => row.id),
  };
}

export async function verifySqliteToSupabase({ sqlitePath, objectDirectory, pool, storage }) {
  if (!sqlitePath || !objectDirectory || !pool || !storage) {
    throw new Error("sqlitePath, objectDirectory, pool, and storage are required.");
  }

  const database = openReadonlySqlite(sqlitePath);
  try {
    const sourceTables = sqliteTableNames(database);
    const schema = await readTargetSchema(pool);
    const tableNames = MIGRATION_TABLE_ORDER.filter((tableName) => schema.has(tableName));
    if (tableNames.length !== MIGRATION_TABLE_ORDER.length) {
      const missing = MIGRATION_TABLE_ORDER.filter((tableName) => !schema.has(tableName));
      throw new Error(`Target database is missing baseline tables: ${missing.join(", ")}.`);
    }

    const sourceCounts = {};
    for (const tableName of tableNames) {
      sourceCounts[tableName] = sourceTables.has(tableName)
        ? Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get().count)
        : 0;
    }
    const targetCounts = await countTargetRows(pool, tableNames);
    const rowMismatches = tableNames
      .filter((tableName) => sourceCounts[tableName] !== targetCounts[tableName])
      .map((tableName) => ({ tableName, source: sourceCounts[tableName], target: targetCounts[tableName] }));

    const sourceManifest = collectObjectManifest(database, sourceTables);
    const local = await inspectLocalObjects(objectDirectory, sourceManifest.objects, sourceManifest.issues);
    const targetManifest = await getTargetObjectManifest(pool);
    const objectManifestMismatches = [...targetManifest.issues];
    for (const [objectKey, sourceObject] of sourceManifest.objects) {
      const targetObject = targetManifest.objects.get(objectKey);
      if (!targetObject) {
        objectManifestMismatches.push({ kind: "missing-target-asset-reference", objectKey });
      } else if (!objectMetadataEqual(sourceObject, targetObject)) {
        objectManifestMismatches.push({ kind: "target-asset-metadata-mismatch", objectKey });
      }
    }
    for (const objectKey of targetManifest.objects.keys()) {
      if (!sourceManifest.objects.has(objectKey)) objectManifestMismatches.push({ kind: "target-only-asset-reference", objectKey });
    }

    const storageMissing = [];
    const storageMismatches = [];
    for (const [objectKey, targetObject] of targetManifest.objects) {
      const remote = await storage.get(objectKey);
      if (!remote) {
        storageMissing.push(objectKey);
        continue;
      }
      for (const detail of checkObject(targetObject, remote, "Supabase Storage object")) {
        storageMismatches.push({ objectKey, detail });
      }
      const localObject = local.local.get(objectKey);
      if (localObject) {
        for (const detail of checkObject(targetObject, localObject, "Local object")) {
          storageMismatches.push({ objectKey, detail });
        }
      }
    }

    const foreignKeys = await inspectForeignKeys(pool);
    const hasForeignKeyProblems = Object.values(foreignKeys).some((values) => values.length > 0);
    const ok = rowMismatches.length === 0
      && !hasForeignKeyProblems
      && local.issues.length === 0
      && objectManifestMismatches.length === 0
      && storageMissing.length === 0
      && storageMismatches.length === 0;

    return {
      ok,
      rows: { source: sourceCounts, target: targetCounts, mismatches: rowMismatches },
      foreignKeys,
      objects: {
        sourceReferenced: sourceManifest.objects.size,
        targetReferenced: targetManifest.objects.size,
        localIssues: local.issues,
        orphanedLocalFiles: local.orphaned,
        manifestMismatches: objectManifestMismatches,
        storageMissing,
        storageMismatches,
      },
    };
  } finally {
    database.close();
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--sqlite", "--objects"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path.`);
      options[argument === "--sqlite" ? "sqlitePath" : "objectDirectory"] = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  options.sqlitePath ??= process.env.ASBIR_MIGRATION_SQLITE_PATH;
  options.objectDirectory ??= process.env.ASBIR_MIGRATION_OBJECTS_DIR;
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/verify-supabase-migration.mjs [--sqlite PATH] [--objects DIR]

Source paths can also come from ASBIR_MIGRATION_SQLITE_PATH and ASBIR_MIGRATION_OBJECTS_DIR.
DATABASE_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are read from the environment.
No .env files are loaded.`);
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) return printUsage();
    if (!options.sqlitePath || !options.objectDirectory) {
      throw new Error("Provide --sqlite and --objects, or set the migration-only source path environment variables.");
    }
    const pool = createPostgresPool(process.env.DATABASE_URL);
    const storage = createSupabaseStorage({
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    try {
      const summary = await verifySqliteToSupabase({ ...options, pool, storage });
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) process.exitCode = 1;
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration verification failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
