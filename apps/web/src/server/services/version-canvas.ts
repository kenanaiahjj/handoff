import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { getDatabase } from "../db";
import { getVersion, getVersionRecord, type StoredSnapshot, type VersionRecord } from "../repositories/versions";

/** Bump when the slim copy's shape changes; older rows are rebuilt on next use. */
export const versionCanvasFormat = 1;

type Measure = { value: number | null };
type AnyNode = Record<string, unknown> & {
  bounds: Record<"x" | "y" | "width" | "height", Measure>;
  typography: { content: string | null } | null;
  fills: Array<{ color: string | null }>;
  strokes: Array<{ color: string | null }>;
  tokens: Array<{ name: string; value: unknown }>;
  sourcePayload?: Record<string, unknown>;
};

function slimMeasure(measure: Measure | undefined): Measure {
  return { value: measure?.value ?? null };
}

/**
 * Keeps exactly the node fields the canvas reads (summarizeCanvasNode and layer exports) and drops
 * the rest (layout, spacing, paints, raw Figma payload), which full element details load per screen.
 */
function slimNode(node: AnyNode) {
  const payload = node.sourcePayload ?? {};
  const sourcePayload: Record<string, unknown> = {};
  if (payload.layerExportAssetKey !== undefined) sourcePayload.layerExportAssetKey = payload.layerExportAssetKey;
  if (payload.layoutGrids !== undefined) sourcePayload.layoutGrids = payload.layoutGrids;
  return {
    sourceNodeId: node.sourceNodeId,
    parentSourceNodeId: node.parentSourceNodeId,
    sourceFrameId: node.sourceFrameId,
    name: node.name,
    type: node.type,
    visible: node.visible,
    bounds: {
      x: slimMeasure(node.bounds?.x),
      y: slimMeasure(node.bounds?.y),
      width: slimMeasure(node.bounds?.width),
      height: slimMeasure(node.bounds?.height),
    },
    typography: node.typography ? { content: node.typography.content } : null,
    fills: (node.fills ?? []).flatMap((paint) => paint.color ? [{ color: paint.color }] : []),
    strokes: (node.strokes ?? []).flatMap((paint) => paint.color ? [{ color: paint.color }] : []),
    tokens: (node.tokens ?? []).map((token) => ({ name: token.name, value: token.value })),
    sourcePayload,
  };
}

/** The capture with each element reduced to what the canvas needs. Frames and metadata are kept whole. */
export function slimCanvasSnapshot(snapshot: StoredSnapshot): StoredSnapshot {
  const frames = (snapshot as { frames?: Array<Record<string, unknown> & { nodes?: AnyNode[] }> }).frames;
  if (!Array.isArray(frames)) return snapshot;
  return {
    ...snapshot,
    frames: frames.map((frame) => Array.isArray(frame.nodes) ? { ...frame, nodes: frame.nodes.map(slimNode) } : frame),
  } as StoredSnapshot;
}

export type CanvasVersion = VersionRecord & { snapshot: StoredSnapshot };

const memory = new Map<string, Promise<StoredSnapshot>>();
const memoryLimit = 8;

function remember(key: string, value: Promise<StoredSnapshot>) {
  memory.set(key, value);
  while (memory.size > memoryLimit) memory.delete(memory.keys().next().value!);
  value.catch(() => { if (memory.get(key) === value) memory.delete(key); });
  return value;
}

async function readStored(versionId: string, contentHash: string) {
  const row = (await getDatabase()
    .prepare("SELECT content_hash AS contentHash, format, encoding, compressed FROM handoff_version_canvas WHERE version_id = ?")
    .get(versionId)) as { contentHash: string; format: number; encoding: string; compressed: Buffer } | undefined;
  if (!row || row.contentHash !== contentHash || row.format !== versionCanvasFormat || row.encoding !== "br") return null;
  return JSON.parse(brotliDecompressSync(row.compressed).toString("utf8")) as StoredSnapshot;
}

async function store(versionId: string, contentHash: string, slim: StoredSnapshot) {
  const compressed = brotliCompressSync(Buffer.from(JSON.stringify(slim), "utf8"), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT },
  });
  await getDatabase()
    .prepare(
      `INSERT INTO handoff_version_canvas (version_id, content_hash, format, encoding, compressed, created_at)
       VALUES (?, ?, ?, 'br', ?, ?)
       ON CONFLICT (version_id) DO UPDATE SET
         content_hash = EXCLUDED.content_hash, format = EXCLUDED.format,
         encoding = EXCLUDED.encoding, compressed = EXCLUDED.compressed, created_at = EXCLUDED.created_at`,
    )
    .run(versionId, contentHash, versionCanvasFormat, compressed, new Date().toISOString());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadSlim(record: VersionRecord) {
  try {
    const stored = await readStored(record.id, record.contentHash);
    if (stored) return stored;
  } catch (error) {
    // A damaged or unreadable copy is rebuilt below; the page never depends on it.
    console.warn(`[canvas] Rebuilding the canvas copy of version ${record.id}: ${errorMessage(error)}`);
  }
  const full = await getVersion({ workspaceId: record.workspaceId, versionId: record.id });
  if (!full) throw new Error("The version's capture could not be read.");
  const slim = slimCanvasSnapshot(full.snapshot);
  try {
    await store(record.id, record.contentHash, slim);
  } catch (error) {
    console.warn(`[canvas] Could not save the canvas copy of version ${record.id}; it will be rebuilt next time: ${errorMessage(error)}`);
  }
  return slim;
}

/**
 * A version as the canvas pages need it, without parsing the full capture when a slim copy exists.
 * Any problem with the copy falls back to the full capture, so display never fails because of it.
 */
export async function getCanvasVersion(input: { workspaceId: string; versionId: string }): Promise<CanvasVersion | null> {
  const record = await getVersionRecord(input);
  if (!record) return null;
  const key = `${record.id}:${record.contentHash}`;
  const snapshot = await (memory.get(key) ?? remember(key, loadSlim(record)));
  return { ...record, snapshot };
}

/** Clears the in-process copies so tests can exercise the database path. */
export function forgetCanvasMemoryForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Unavailable in production.");
  memory.clear();
}
