import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, open, readFile, readdir, realpath, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRequire = createRequire(path.join(repositoryRoot, "apps/web/package.json"));
const Sqlite = webRequire("better-sqlite3");
const { Pool } = webRequire("pg");

export const MIGRATION_TABLE_ORDER = [
  "user",
  "account",
  "session",
  "verification",
  "workspace",
  "workspace_membership",
  "workspace_invite",
  "user_profile",
  "superadmin",
  "project",
  "handoff",
  "handoff_version",
  "capture_session",
  "handoff_version_snapshot",
  "handoff_asset",
  "handoff_invite",
  "handoff_comment",
  "handoff_annotation",
  "handoff_frame_replacement",
  "handoff_node_replacement",
  "changelog_draft",
  "comment_mention",
  "comparison_cache",
  "handoff_view",
  "layout_finding_comment",
  "layout_finding_state",
  "linked_external_task",
  "notification_preference",
  "project_icon",
  "viewer_pin",
  "workspace_mcp_token",
];

const deferredHandoffColumn = "published_version_id";
const bucketName = "handoff-assets";
const defaultBatchSize = 100;

function quoteIdentifier(identifier) {
  if (typeof identifier !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new TypeError(`Unsupported SQL identifier: ${String(identifier)}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function sqliteTableNames(database) {
  return new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name),
  );
}

function sqliteColumns(database, tableName) {
  return database.pragma(`table_info(${quoteIdentifier(tableName)})`).map((column) => column.name);
}

function parseBoolean(value, tableName, columnName) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 0n || value === "0" || value === "false") return false;
  if (value === 1 || value === 1n || value === "1" || value === "true") return true;
  throw new TypeError(`Cannot convert ${tableName}.${columnName} to boolean.`);
}

function parseTimestamp(value, tableName, columnName) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`Invalid timestamp in ${tableName}.${columnName}.`);
    return value;
  }

  let milliseconds;
  if (typeof value === "number" || typeof value === "bigint") {
    const numericValue = Number(value);
    milliseconds = Math.abs(numericValue) < 100_000_000_000 ? numericValue * 1000 : numericValue;
  } else if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const numericValue = Number(value);
    milliseconds = Math.abs(numericValue) < 100_000_000_000 ? numericValue * 1000 : numericValue;
  } else {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new TypeError(`Invalid timestamp in ${tableName}.${columnName}.`);
    return parsed;
  }

  const parsed = new Date(milliseconds);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Invalid timestamp in ${tableName}.${columnName}.`);
  return parsed;
}

function normalizeForPostgres(value, column, tableName) {
  if (value == null) return null;

  if (column.data_type === "boolean") return parseBoolean(value, tableName, column.column_name);
  if (column.data_type === "timestamp with time zone" || column.data_type === "timestamp without time zone") {
    return parseTimestamp(value, tableName, column.column_name);
  }
  if (column.data_type === "bytea") {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    throw new TypeError(`Cannot convert ${tableName}.${column.column_name} to bytea.`);
  }
  if (column.data_type === "jsonb") {
    if (typeof value === "string") return JSON.parse(value);
    return value;
  }
  if (column.data_type === "bigint") return String(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return value;
}

function canonical(value, column) {
  if (value == null) return null;
  if (column?.data_type === "timestamp with time zone" || column?.data_type === "timestamp without time zone") {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  if (column?.data_type === "bytea") {
    if (Buffer.isBuffer(value)) return value.toString("hex");
    if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
    if (typeof value === "string" && value.startsWith("\\x")) return value.slice(2);
  }
  if (column?.data_type === "jsonb") return stableJson(value);
  if (column?.data_type === "bigint") return String(value);
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function openReadonlySqlite(sqlitePath) {
  const database = new Sqlite(sqlitePath, { readonly: true, fileMustExist: true });
  database.pragma("query_only = ON");
  return database;
}

export async function readTargetSchema(pool) {
  const [columnResult, primaryKeyResult] = await Promise.all([
    pool.query(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
    ),
    pool.query(
      `SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY tc.table_name, kcu.ordinal_position`,
    ),
  ]);

  const tables = new Map();
  for (const column of columnResult.rows) {
    if (!tables.has(column.table_name)) tables.set(column.table_name, { columns: [], primaryKey: [] });
    tables.get(column.table_name).columns.push(column);
  }
  for (const key of primaryKeyResult.rows) tables.get(key.table_name)?.primaryKey.push(key.column_name);
  return tables;
}

function sqliteRowCount(database, tableName) {
  if (!sqliteTableNames(database).has(tableName)) return 0;
  return database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get().count;
}

export function collectObjectManifest(database, sourceTables) {
  const issues = [];
  const objects = new Map();
  if (!sourceTables.has("handoff_asset")) return { objects, issues };

  for (const asset of database.prepare("SELECT object_key, content_type, size_bytes, sha256 FROM handoff_asset").iterate()) {
    const objectKey = String(asset.object_key ?? "");
    if (!/^[a-f0-9]{48}$/.test(objectKey)) {
      issues.push({ kind: "invalid-object-key", objectKey });
      continue;
    }

    const expected = {
      objectKey,
      contentType: String(asset.content_type ?? ""),
      sizeBytes: Number(asset.size_bytes),
      sha256: String(asset.sha256 ?? "").toLowerCase(),
    };
    const existing = objects.get(objectKey);
    if (existing && (existing.contentType !== expected.contentType || existing.sizeBytes !== expected.sizeBytes || existing.sha256 !== expected.sha256)) {
      issues.push({ kind: "conflicting-asset-metadata", objectKey });
      continue;
    }
    objects.set(objectKey, expected);
  }

  return { objects, issues };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeContentType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

export function checkObject(expected, object, location) {
  const mismatches = [];
  if (!object) return [`${location} is missing`];
  if (object.bytes.byteLength !== expected.sizeBytes) mismatches.push(`${location} size is ${object.bytes.byteLength}, expected ${expected.sizeBytes}`);
  if (sha256(object.bytes) !== expected.sha256) mismatches.push(`${location} SHA-256 does not match`);
  if (normalizeContentType(object.contentType) !== normalizeContentType(expected.contentType)) {
    mismatches.push(`${location} content type does not match`);
  }
  return mismatches;
}

export async function inspectLocalObjects(objectDirectory, objects, initialIssues = []) {
  const issues = [...initialIssues];
  const local = new Map();
  let entries = [];
  try {
    entries = await readdir(objectDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const referencedKeys = new Set(objects.keys());
  const orphaned = entries
    .filter((entry) => entry.isFile() && /^[a-f0-9]{48}$/.test(entry.name) && !referencedKeys.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const [objectKey, expected] of objects) {
    let bytes;
    let metadata;
    try {
      bytes = await readFile(path.join(objectDirectory, objectKey));
      metadata = JSON.parse(await readFile(path.join(objectDirectory, `${objectKey}.json`), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        issues.push({ kind: "missing-local-object", objectKey });
        continue;
      }
      if (error instanceof SyntaxError) {
        issues.push({ kind: "invalid-local-object-metadata", objectKey });
        continue;
      }
      throw error;
    }

    const object = { bytes, contentType: metadata.contentType };
    const mismatches = checkObject(expected, object, "Local object");
    for (const detail of mismatches) issues.push({ kind: "local-object-mismatch", objectKey, detail });
    local.set(objectKey, object);
  }

  return { issues, local, orphaned };
}

export function createSupabaseStorage({ url, serviceRoleKey, fetchImpl = fetch, bucket = bucketName }) {
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Storage operations.");
  const baseUrl = new URL(url);
  const endpoint = (key) => new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, baseUrl);
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  };

  return {
    async get(key) {
      const response = await fetchImpl(endpoint(key), { method: "GET", headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Supabase Storage read failed (${response.status}).`);
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "",
      };
    },
    async put(key, bytes, contentType) {
      const response = await fetchImpl(endpoint(key), {
        method: "POST",
        headers: { ...headers, "content-type": contentType, "cache-control": "3600" },
        body: bytes,
      });
      if (!response.ok) throw new Error(`Supabase Storage upload failed (${response.status}).`);
    },
  };
}

async function atomicWriteJson(filePath, value) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, absolutePath);
  const directoryHandle = await open(path.dirname(absolutePath), "r").catch(() => null);
  if (directoryHandle) {
    await directoryHandle.sync().catch(() => undefined);
    await directoryHandle.close();
  }
}

async function migrationIdentity(sqlitePath, objectDirectory) {
  const sqliteFile = await realpath(sqlitePath);
  const objectRoot = await realpath(objectDirectory).catch((error) => {
    if (error.code === "ENOENT") return path.resolve(objectDirectory);
    throw error;
  });
  const fileStat = await stat(sqliteFile);
  return {
    sqliteFile,
    sqliteSize: fileStat.size,
    sqliteMtimeMs: fileStat.mtimeMs,
    objectDirectory: objectRoot,
  };
}

function assertCheckpointOutsideSource(checkpointPath, identity) {
  const absoluteCheckpoint = path.resolve(checkpointPath);
  const protectedRoots = [path.dirname(identity.sqliteFile), identity.objectDirectory];
  for (const root of protectedRoots) {
    const relative = path.relative(root, absoluteCheckpoint);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error("Store the migration checkpoint outside the source SQLite and object directories.");
    }
  }
}

async function loadCheckpoint(checkpointPath, identity) {
  if (!checkpointPath) return { version: 1, identity, completedObjects: {}, completedTables: {} };
  let existing;
  try {
    existing = JSON.parse(await readFile(checkpointPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, identity, completedObjects: {}, completedTables: {} };
    if (error instanceof SyntaxError) throw new Error(`Migration checkpoint is not valid JSON: ${checkpointPath}`);
    throw error;
  }
  if (existing.version !== 1 || JSON.stringify(existing.identity) !== JSON.stringify(identity)) {
    throw new Error("Migration checkpoint belongs to a different source SQLite file or object directory.");
  }
  return {
    version: 1,
    identity,
    completedObjects: existing.completedObjects ?? {},
    completedTables: existing.completedTables ?? {},
  };
}

async function saveCheckpoint(checkpointPath, state) {
  if (checkpointPath) await atomicWriteJson(checkpointPath, state);
}

function primaryKeyIdentity(row, primaryKey) {
  return JSON.stringify(primaryKey.map((column) => row[column] ?? null));
}

function buildTuplePredicate(rows, columns, startIndex = 1) {
  const values = [];
  const tuples = rows.map((row) => {
    const parts = columns.map((column) => {
      values.push(row[column]);
      return `$${startIndex + values.length - 1}`;
    });
    return `(${parts.join(", ")})`;
  });
  return { sql: `(${columns.map(quoteIdentifier).join(", ")}) IN (${tuples.join(", ")})`, values };
}

function batched(items, batchSize) {
  const result = [];
  for (let index = 0; index < items.length; index += batchSize) result.push(items.slice(index, index + batchSize));
  return result;
}

async function importTable({ database, client, tableName, tableSchema, sourceColumns, batchSize, deferredHandoffs = [] }) {
  if (!sourceColumns.length) return { sourceRows: 0, insertedRows: 0, existingRows: 0 };
  const sourceColumnSet = new Set(sourceColumns);
  const columns = tableSchema.columns.filter((column) => sourceColumnSet.has(column.column_name) && !(tableName === "handoff" && column.column_name === deferredHandoffColumn));
  if (!columns.length) throw new Error(`Source table ${tableName} has no columns that match the target schema.`);
  const missingRequired = tableSchema.columns.filter((column) =>
    column.is_nullable === "NO" && column.column_default == null && !sourceColumnSet.has(column.column_name),
  );
  if (missingRequired.length) {
    throw new Error(`Source table ${tableName} is missing required columns: ${missingRequired.map((column) => column.column_name).join(", " )}.`);
  }
  if (!tableSchema.primaryKey.length) throw new Error(`Target table ${tableName} has no primary key; conflict-safe import is unavailable.`);

  const columnNames = columns.map((column) => column.column_name);
  const selectSql = `SELECT ${sourceColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(tableName)}`;
  const iterator = database.prepare(selectSql).iterate();
  let sourceRows = 0;
  let insertedRows = 0;
  let existingRows = 0;
  let batch = [];

  async function flushBatch() {
    if (!batch.length) return;
    const values = [];
    const placeholders = batch.map((row) => `(${columns.map((column) => {
      values.push(normalizeForPostgres(row[column.column_name], column, tableName));
      return `$${values.length}`;
    }).join(", ")})`);
    const primaryKeySql = tableSchema.primaryKey.map(quoteIdentifier).join(", ");
    const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columnNames.map(quoteIdentifier).join(", ")})
      VALUES ${placeholders.join(", ")}
      ON CONFLICT DO NOTHING
      RETURNING ${primaryKeySql}`;
    const result = await client.query(sql, values);
    insertedRows += result.rowCount ?? result.rows.length;

    const inserted = new Set(result.rows.map((row) => primaryKeyIdentity(row, tableSchema.primaryKey)));
    const skippedRows = batch.filter((row) => !inserted.has(primaryKeyIdentity(row, tableSchema.primaryKey)));
    if (skippedRows.length) {
      const predicate = buildTuplePredicate(skippedRows, tableSchema.primaryKey);
      const existingResult = await client.query(
        `SELECT ${columnNames.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(tableName)} WHERE ${predicate.sql}`,
        predicate.values,
      );
      const existingByKey = new Map(existingResult.rows.map((row) => [primaryKeyIdentity(row, tableSchema.primaryKey), row]));
      for (const sourceRow of skippedRows) {
        const existingRow = existingByKey.get(primaryKeyIdentity(sourceRow, tableSchema.primaryKey));
        if (!existingRow) {
          throw new Error(`A unique-key conflict in ${tableName} does not match the source primary key.`);
        }
        const mismatch = columns.find((column) =>
          canonical(normalizeForPostgres(sourceRow[column.column_name], column, tableName), column) !== canonical(existingRow[column.column_name], column),
        );
        if (mismatch) {
          throw new Error(`Existing ${tableName} row conflicts with source column ${mismatch.column_name}.`);
        }
      }
      existingRows += skippedRows.length;
    }
    batch = [];
  }

  if (tableName === "handoff_comment") {
    await client.query("SET CONSTRAINTS handoff_comment_parent_comment_id_fkey DEFERRED");
  }

  for (const sourceRow of iterator) {
    sourceRows += 1;
    if (tableName === "handoff" && sourceRow[deferredHandoffColumn] != null) {
      deferredHandoffs.push({ id: sourceRow.id, publishedVersionId: sourceRow[deferredHandoffColumn] });
    }
    batch.push(sourceRow);
    if (batch.length >= batchSize) await flushBatch();
  }
  await flushBatch();
  return { sourceRows, insertedRows, existingRows };
}

async function importPublishedVersionReferences(client, deferredHandoffs) {
  for (const handoff of deferredHandoffs) {
    const version = await client.query(
      "SELECT handoff_id FROM handoff_version WHERE id = $1",
      [handoff.publishedVersionId],
    );
    if (version.rows[0]?.handoff_id !== handoff.id) {
      throw new Error(`Published version for handoff ${handoff.id} does not belong to that handoff.`);
    }

    const current = await client.query("SELECT published_version_id FROM handoff WHERE id = $1", [handoff.id]);
    if (!current.rows[0]) throw new Error(`Handoff ${handoff.id} was not imported.`);
    const currentVersionId = current.rows[0].published_version_id;
    if (currentVersionId != null && currentVersionId !== handoff.publishedVersionId) {
      throw new Error(`Published version for handoff ${handoff.id} conflicts with the target database.`);
    }
    if (currentVersionId == null) {
      await client.query("UPDATE handoff SET published_version_id = $1 WHERE id = $2 AND published_version_id IS NULL", [handoff.publishedVersionId, handoff.id]);
    }
  }
}

export async function countTargetRows(pool, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const result = await pool.query(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(tableName)}`);
    counts[tableName] = Number(result.rows[0].count);
  }
  return counts;
}

async function inspectRemoteObjects(storage, objects) {
  if (!storage) return { missing: [], mismatches: [] };
  const missing = [];
  const mismatches = [];
  for (const [objectKey, expected] of objects) {
    const remote = await storage.get(objectKey);
    if (!remote) {
      missing.push(objectKey);
      continue;
    }
    for (const detail of checkObject(expected, remote, "Supabase Storage object")) {
      mismatches.push({ objectKey, detail });
    }
  }
  return { missing, mismatches };
}

export async function migrateSqliteToSupabase({
  sqlitePath,
  objectDirectory,
  pool,
  storage,
  dryRun = true,
  checkpointPath,
  batchSize = defaultBatchSize,
}) {
  if (!sqlitePath || !objectDirectory || !pool) throw new Error("sqlitePath, objectDirectory, and pool are required.");
  if (!dryRun && !checkpointPath) throw new Error("An explicit checkpointPath is required for apply mode.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("batchSize must be an integer from 1 to 1000.");

  const database = openReadonlySqlite(sqlitePath);
  try {
    const sourceTables = sqliteTableNames(database);
    const schema = await readTargetSchema(pool);
    const targetTables = MIGRATION_TABLE_ORDER.filter((tableName) => schema.has(tableName));
    if (targetTables.length !== MIGRATION_TABLE_ORDER.length) {
      const missing = MIGRATION_TABLE_ORDER.filter((tableName) => !schema.has(tableName));
      throw new Error(`Target database is missing baseline tables: ${missing.join(", ")}.`);
    }

    const assetManifest = collectObjectManifest(database, sourceTables);
    const localObjects = await inspectLocalObjects(objectDirectory, assetManifest.objects, assetManifest.issues);
    const identity = await migrationIdentity(sqlitePath, objectDirectory);
    if (!dryRun) assertCheckpointOutsideSource(checkpointPath, identity);
    const checkpoint = await loadCheckpoint(checkpointPath, identity);
    const remoteObjects = dryRun
      ? await inspectRemoteObjects(storage, assetManifest.objects)
      : { missing: [], mismatches: [] };
    const rowCounts = {};
    for (const tableName of targetTables) rowCounts[tableName] = sqliteRowCount(database, tableName);
    const targetCountsBefore = await countTargetRows(pool, targetTables);

    const objectProblems = localObjects.issues.length > 0;
    const remoteProblems = remoteObjects.mismatches.length > 0;
    const summary = {
      mode: dryRun ? "dry-run" : "apply",
      source: { sqlitePath: identity.sqliteFile, objectDirectory: identity.objectDirectory },
      rows: { source: rowCounts, targetBefore: targetCountsBefore },
      objects: {
        referenced: assetManifest.objects.size,
        localIssues: localObjects.issues,
        orphanedLocalFiles: localObjects.orphaned,
        remoteMissing: remoteObjects.missing,
        remoteMismatches: remoteObjects.mismatches,
        copied: 0,
        reused: 0,
      },
      completedTables: Object.keys(checkpoint.completedTables).length,
      ok: !objectProblems && !remoteProblems,
    };

    if (dryRun || objectProblems || remoteProblems) return summary;
    if (!storage) throw new Error("Storage adapter is required for apply mode.");

    for (const [objectKey, expected] of assetManifest.objects) {
      const local = localObjects.local.get(objectKey);
      if (!local) continue;
      let remote = await storage.get(objectKey);
      let reused = Boolean(remote);
      if (remote) {
        const mismatches = checkObject(expected, remote, "Supabase Storage object");
        if (mismatches.length) {
          summary.objects.remoteMismatches.push(...mismatches.map((detail) => ({ objectKey, detail })));
          summary.ok = false;
          return summary;
        }
      } else {
        try {
          await storage.put(objectKey, local.bytes, expected.contentType);
        } catch (error) {
          remote = await storage.get(objectKey);
          if (!remote) throw error;
        }
        remote = await storage.get(objectKey);
        if (!remote) {
          summary.objects.remoteMissing.push(objectKey);
          summary.ok = false;
          return summary;
        }
        const mismatches = checkObject(expected, remote, "Supabase Storage object");
        if (mismatches.length) {
          summary.objects.remoteMismatches.push(...mismatches.map((detail) => ({ objectKey, detail })));
          summary.ok = false;
          return summary;
        }
        reused = false;
      }

      if (reused) summary.objects.reused += 1;
      else summary.objects.copied += 1;
      summary.objects.remoteMissing = summary.objects.remoteMissing.filter((key) => key !== objectKey);
      checkpoint.completedObjects[objectKey] = {
        sizeBytes: expected.sizeBytes,
        sha256: expected.sha256,
        contentType: expected.contentType,
        verifiedAt: new Date().toISOString(),
      };
      await saveCheckpoint(checkpointPath, checkpoint);
    }

    const importedRows = {};
    const deferredHandoffs = [];
    const client = await pool.connect();
    try {
      for (const tableName of targetTables) {
        const tableSchema = schema.get(tableName);
        const presentColumns = sourceTables.has(tableName) ? sqliteColumns(database, tableName) : [];
        if (!presentColumns.length) {
          importedRows[tableName] = { sourceRows: 0, insertedRows: 0, existingRows: 0 };
          checkpoint.completedTables[tableName] = { sourceRows: 0, completedAt: new Date().toISOString() };
          await saveCheckpoint(checkpointPath, checkpoint);
          continue;
        }

        await client.query("BEGIN");
        try {
          importedRows[tableName] = await importTable({
            database,
            client,
            tableName,
            tableSchema,
            sourceColumns: presentColumns,
            batchSize,
            deferredHandoffs,
          });
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }

        checkpoint.completedTables[tableName] = {
          sourceRows: importedRows[tableName].sourceRows,
          completedAt: new Date().toISOString(),
        };
        await saveCheckpoint(checkpointPath, checkpoint);
      }

      if (deferredHandoffs.length) {
        await client.query("BEGIN");
        try {
          await importPublishedVersionReferences(client, deferredHandoffs);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      }
    } finally {
      client.release();
    }

    summary.rows.imported = importedRows;
    summary.rows.targetAfter = await countTargetRows(pool, targetTables);
    summary.completedTables = Object.keys(checkpoint.completedTables).length;
    return summary;
  } finally {
    database.close();
  }
}

export function createPostgresPool(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL must be set explicitly in the environment.");
  const hostname = new URL(connectionString).hostname.toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return new Pool({ connectionString, max: 1, ssl: isLocal ? false : { rejectUnauthorized: true } });
}

export { quoteIdentifier };

export function parseMigrationArguments(argv) {
  const options = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.dryRun = false;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (["--sqlite", "--objects", "--checkpoint"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path.`);
      options[{ "--sqlite": "sqlitePath", "--objects": "objectDirectory", "--checkpoint": "checkpointPath" }[argument]] = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  options.sqlitePath ??= process.env.ASBIR_MIGRATION_SQLITE_PATH;
  options.objectDirectory ??= process.env.ASBIR_MIGRATION_OBJECTS_DIR;
  options.checkpointPath ??= process.env.ASBIR_MIGRATION_CHECKPOINT_PATH;
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/migrate-sqlite-to-supabase.mjs [--dry-run|--apply] [--sqlite PATH] [--objects DIR] [--checkpoint PATH]

The default mode is dry-run. Source paths can also come from ASBIR_MIGRATION_SQLITE_PATH,
ASBIR_MIGRATION_OBJECTS_DIR, and ASBIR_MIGRATION_CHECKPOINT_PATH. DATABASE_URL targets Postgres.
Apply mode also requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. No .env files are loaded.`);
}

async function main() {
  let options;
  try {
    options = parseMigrationArguments(process.argv.slice(2));
    if (options.help) return printUsage();
    if (!options.sqlitePath || !options.objectDirectory) {
      throw new Error("Provide --sqlite and --objects, or set the migration-only source path environment variables.");
    }
    const pool = createPostgresPool(process.env.DATABASE_URL);
    const storage = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createSupabaseStorage({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY })
      : undefined;
    try {
      if (!options.dryRun && !storage) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for apply mode.");
      const summary = await migrateSqliteToSupabase({ ...options, pool, storage });
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) process.exitCode = 1;
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
