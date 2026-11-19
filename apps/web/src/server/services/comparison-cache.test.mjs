import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY);
  CREATE TABLE handoff_frame_replacement (handoff_id TEXT, baseline_version_id TEXT, new_version_id TEXT, before_frame_id TEXT, after_frame_id TEXT);
  CREATE TABLE handoff_node_replacement (handoff_id TEXT, baseline_version_id TEXT, new_version_id TEXT, before_frame_id TEXT, after_frame_id TEXT, before_node_id TEXT, after_node_id TEXT);
`);
const comparisonMigration = readFileSync(new URL("../migrations/0022_comparison_cache.sql", import.meta.url), "utf8").replace("BLOB", "BYTEA");
await pool.query(comparisonMigration);
await database.prepare("INSERT INTO handoff_version VALUES ('v1'), ('v2')").run();

const { matchStateKey, readSavedComparison, saveComparison } = await import("./comparison-cache.ts");

after(async () => fixture.close());

test("a saved comparison reads back exactly, until a match is confirmed", async () => {
  const json = JSON.stringify({ diff: { frames: [{ frameId: "a", status: "changed" }] }, frames: [{ name: "Home · Café" }] });
  const key = await matchStateKey("h");
  const unversionedKey = createHash("sha256").update(JSON.stringify({ frames: [], nodes: [] })).digest("hex");
  assert.notEqual(key, unversionedKey, "diff algorithm changes must invalidate saved comparisons");
  assert.equal(await readSavedComparison({ fromVersionId: "v1", toVersionId: "v2", matchKey: key }), null);

  await saveComparison({ handoffId: "h", fromVersionId: "v1", toVersionId: "v2", matchKey: key, json });
  assert.equal(await readSavedComparison({ fromVersionId: "v1", toVersionId: "v2", matchKey: key }), json);

  // Confirming a screen match changes the key, so the old result is no longer served.
  await database.prepare("INSERT INTO handoff_frame_replacement VALUES ('h', 'v1', 'v2', 'a', 'b')").run();
  const newKey = await matchStateKey("h");
  assert.notEqual(newKey, key);
  assert.equal(await readSavedComparison({ fromVersionId: "v1", toVersionId: "v2", matchKey: newKey }), null);

  // Matches in another handoff don't affect this one.
  await database.prepare("INSERT INTO handoff_node_replacement VALUES ('other', 'x', 'y', 'a', 'b', 'n1', 'n2')").run();
  assert.equal(await matchStateKey("h"), newKey);
});

test("deleting a version removes its saved comparisons", async () => {
  await saveComparison({ handoffId: "h", fromVersionId: "v1", toVersionId: "v2", matchKey: "k", json: "{}" });
  await database.prepare("DELETE FROM handoff_version WHERE id = 'v1'").run();
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM comparison_cache WHERE from_version_id = 'v1'").get()).n, 0);
});
