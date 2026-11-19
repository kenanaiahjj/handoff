/**
 * One-time repair: the first production sign-in raced and created two company workspaces. This moves
 * everything in the newer one into the one the app opens (the oldest), then removes the empty newer
 * one. It runs in a single transaction and only commits if every foreign key still points at an
 * existing row afterwards. Running it again after a merge does nothing.
 */

const roleStrength = { owner: 4, designer: 3, developer: 2, qa: 2, reviewer: 1 };

/** Tables whose workspace rows need more than a plain `UPDATE ... SET workspace_id`. */
const specialTables = new Set(["workspace_membership", "workspace_logo", "handoff_snapshot_frame_chunk"]);

/**
 * @param {import("pg").ClientBase} client a dedicated connection (not a pool)
 * @param {{ keeperId: string, duplicateId: string, log?: (line: string) => void }} input
 */
export async function mergeDuplicateWorkspaces(client, { keeperId, duplicateId, log = console.log }) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  await client.query("BEGIN");
  try {
    const workspaces = await q(
      "SELECT id, name, created_at, allowed_email_domains FROM workspace WHERE id = ANY($1) FOR UPDATE",
      [[keeperId, duplicateId]],
    );
    const keeper = workspaces.find((row) => row.id === keeperId);
    const duplicate = workspaces.find((row) => row.id === duplicateId);
    if (!duplicate) {
      log(`Workspace merge: ${duplicateId} is already gone; nothing to do.`);
      await client.query("ROLLBACK");
      return { merged: false };
    }
    if (!keeper) throw new Error(`Workspace merge: the workspace to keep (${keeperId}) does not exist.`);
    const [oldest] = await q("SELECT id FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1");
    if (oldest.id !== keeperId) throw new Error("Workspace merge: the workspace to keep is not the one the app opens (the oldest).");

    // Moving rows changes workspace_id on both sides of composite foreign keys, and saved versions are
    // protected by a trigger. Replica mode skips both for this transaction only; the checks below
    // re-verify every foreign key before committing.
    await client.query("SET LOCAL session_replication_role = replica");
    const moved = {};

    // Project names are unique per workspace.
    const keeperNames = new Set((await q("SELECT name FROM project WHERE workspace_id = $1", [keeperId])).map((row) => row.name));
    for (const project of await q("SELECT id, name FROM project WHERE workspace_id = $1", [duplicateId])) {
      if (!keeperNames.has(project.name)) { keeperNames.add(project.name); continue; }
      let suffix = 2;
      while (keeperNames.has(`${project.name} (${suffix})`)) suffix += 1;
      const name = `${project.name} (${suffix})`;
      await client.query("UPDATE project SET name = $1 WHERE id = $2", [name, project.id]);
      keeperNames.add(name);
      log(`Workspace merge: renamed project "${project.name}" to "${name}" to avoid a clash.`);
    }

    // Members: keep the stronger role when someone is in both.
    let members = 0;
    for (const member of await q("SELECT user_id, role FROM workspace_membership WHERE workspace_id = $1", [duplicateId])) {
      const [existing] = await q("SELECT role FROM workspace_membership WHERE workspace_id = $1 AND user_id = $2", [keeperId, member.user_id]);
      if (!existing) {
        await client.query("UPDATE workspace_membership SET workspace_id = $1 WHERE workspace_id = $2 AND user_id = $3", [keeperId, duplicateId, member.user_id]);
      } else {
        if ((roleStrength[member.role] ?? 0) > (roleStrength[existing.role] ?? 0)) {
          await client.query("UPDATE workspace_membership SET role = $1 WHERE workspace_id = $2 AND user_id = $3", [member.role, keeperId, member.user_id]);
        }
        await client.query("DELETE FROM workspace_membership WHERE workspace_id = $1 AND user_id = $2", [duplicateId, member.user_id]);
      }
      members += 1;
    }
    moved.workspace_membership = members;

    // Logo and allowed domains: keep the kept workspace's own, fill gaps from the other.
    const [keeperLogo] = await q("SELECT 1 FROM workspace_logo WHERE workspace_id = $1", [keeperId]);
    if (keeperLogo) await client.query("DELETE FROM workspace_logo WHERE workspace_id = $1", [duplicateId]);
    else moved.workspace_logo = (await client.query("UPDATE workspace_logo SET workspace_id = $1 WHERE workspace_id = $2", [keeperId, duplicateId])).rowCount;
    if (!keeper.allowed_email_domains && duplicate.allowed_email_domains) {
      await client.query("UPDATE workspace SET allowed_email_domains = $1 WHERE id = $2", [duplicate.allowed_email_domains, keeperId]);
    }

    // Snapshot chunks are keyed by content hash, so identical chunks may already exist in the kept workspace.
    moved.handoff_snapshot_frame_chunk = (await client.query(
      `INSERT INTO handoff_snapshot_frame_chunk
       SELECT (jsonb_populate_record(NULL::handoff_snapshot_frame_chunk, to_jsonb(chunk) || jsonb_build_object('workspace_id', $1::text))).*
       FROM handoff_snapshot_frame_chunk chunk WHERE chunk.workspace_id = $2
       ON CONFLICT DO NOTHING`,
      [keeperId, duplicateId],
    )).rowCount;

    // Everything else carries workspace_id as a plain column.
    const tables = await q(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'workspace_id' AND table_name <> 'workspace'
       ORDER BY table_name`,
    );
    for (const { table_name: table } of tables) {
      if (specialTables.has(table)) continue;
      const { rowCount } = await client.query(`UPDATE "${table}" SET workspace_id = $1 WHERE workspace_id = $2`, [keeperId, duplicateId]);
      if (rowCount) moved[table] = rowCount;
    }
    await client.query("DELETE FROM handoff_snapshot_frame_chunk WHERE workspace_id = $1", [duplicateId]);

    // Pins on the workspace itself.
    await client.query(
      `DELETE FROM viewer_pin dup WHERE dup.kind = 'workspace' AND dup.target_id = $2
       AND EXISTS (SELECT 1 FROM viewer_pin keep WHERE keep.user_id = dup.user_id AND keep.kind = 'workspace' AND keep.target_id = $1)`,
      [keeperId, duplicateId],
    );
    await client.query("UPDATE viewer_pin SET target_id = $1 WHERE kind = 'workspace' AND target_id = $2", [keeperId, duplicateId]);

    await client.query("SET LOCAL session_replication_role = origin");

    // Nothing may still point at the duplicate.
    for (const { table_name: table } of tables) {
      const [{ n }] = await q(`SELECT count(*)::int AS n FROM "${table}" WHERE workspace_id = $1`, [duplicateId]);
      if (n) throw new Error(`Workspace merge: ${n} row(s) in ${table} still belong to the duplicate workspace.`);
    }

    // Every foreign key in the app schema must still resolve, since replica mode skipped the checks.
    const foreignKeys = await q(
      `SELECT con.conname, child.relname AS child, parent.relname AS parent,
              array_agg(ca.attname::text ORDER BY k.ord) AS child_cols,
              array_agg(pa.attname::text ORDER BY k.ord) AS parent_cols
       FROM pg_constraint con
       JOIN pg_class child ON child.oid = con.conrelid
       JOIN pg_class parent ON parent.oid = con.confrelid
       JOIN pg_namespace ns ON ns.oid = child.relnamespace AND ns.nspname = 'public'
       CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(child_att, parent_att, ord)
       JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = k.child_att
       JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = k.parent_att
       WHERE con.contype = 'f'
       GROUP BY con.conname, child.relname, parent.relname`,
    );
    for (const fk of foreignKeys) {
      const notNull = fk.child_cols.map((col) => `c."${col}" IS NOT NULL`).join(" AND ");
      const match = fk.child_cols.map((col, index) => `p."${fk.parent_cols[index]}" = c."${col}"`).join(" AND ");
      const [{ n }] = await q(
        `SELECT count(*)::int AS n FROM "${fk.child}" c WHERE ${notNull}
         AND NOT EXISTS (SELECT 1 FROM "${fk.parent}" p WHERE ${match})`,
      );
      if (n) throw new Error(`Workspace merge: ${n} row(s) in ${fk.child} break foreign key ${fk.conname}.`);
    }

    await client.query("DELETE FROM workspace WHERE id = $1", [duplicateId]);
    await client.query("COMMIT");
    log(`Workspace merge: moved ${JSON.stringify(moved)} from ${duplicateId} into ${keeperId}, checked ${foreignKeys.length} foreign keys, and removed the duplicate.`);
    return { merged: true, moved };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

const isCli = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isCli) {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
    console.log("Skipping the workspace merge outside Vercel Production.");
    process.exit(0);
  }
  const { Client } = await import("pg");
  const connectionString = process.env.DATABASE_URL?.trim();
  const hostname = new URL(connectionString).hostname.toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const supabaseCa = process.env.SUPABASE_DB_SSL_CA?.trim();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    ssl: isLocal ? false : { rejectUnauthorized: true, ...(supabaseCa ? { ca: supabaseCa } : {}) },
  });
  await client.connect();
  try {
    await mergeDuplicateWorkspaces(client, {
      keeperId: "25ad4bfd-4e41-4bef-bb8c-9d48310f8690",
      duplicateId: "2c705bb2-a282-457a-85c4-0539c157ec93",
    });
  } catch (error) {
    // A failed merge rolls back completely; the deploy goes ahead so the site keeps working.
    console.error(error instanceof Error ? error.message : error);
  } finally {
    await client.end().catch(() => {});
  }
}
