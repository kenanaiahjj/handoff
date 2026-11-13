import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";
import { POST } from "./route.ts";
import { createWorkspaceMcpToken } from "../../../src/server/repositories/mcp-tokens.ts";

const priorDatabase = globalThis.__asbirDatabase;
const database = new Database(":memory:");
globalThis.__asbirDatabase = database;

database.exec(`
  CREATE TABLE workspace_membership (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE workspace_mcp_token (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, rules_json TEXT NOT NULL, pd_in_charge_user_id TEXT, created_at TEXT NOT NULL);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, review_share_id TEXT, published_version_id TEXT, published_at TEXT, published_by_user_id TEXT, sharing_mode TEXT NOT NULL DEFAULT 'workspace');
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, version_label TEXT NOT NULL, release_note TEXT, source TEXT NOT NULL, source_file_id TEXT NOT NULL, source_revision_id TEXT, captured_at TEXT NOT NULL, content_hash TEXT NOT NULL, visual_only INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE handoff_frame_replacement (handoff_id TEXT NOT NULL, workspace_id TEXT NOT NULL, baseline_version_id TEXT NOT NULL, new_version_id TEXT NOT NULL, before_frame_id TEXT NOT NULL, after_frame_id TEXT NOT NULL, confirmed_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE handoff_node_replacement (handoff_id TEXT NOT NULL, workspace_id TEXT NOT NULL, baseline_version_id TEXT NOT NULL, new_version_id TEXT NOT NULL, before_frame_id TEXT NOT NULL, after_frame_id TEXT NOT NULL, before_node_id TEXT NOT NULL, after_node_id TEXT NOT NULL, confirmed_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE handoff_asset (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_version_id TEXT NOT NULL, asset_key TEXT NOT NULL, object_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, width INTEGER, height INTEGER);
  CREATE TABLE linked_external_task (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, version_id TEXT NOT NULL, source_system TEXT NOT NULL, external_task_id TEXT, external_url TEXT, title TEXT NOT NULL, description TEXT NOT NULL, evidence_json TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, agent_run_url TEXT, pull_request_url TEXT);
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE handoff_comment (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_version_id TEXT NOT NULL, frame_id TEXT NOT NULL, source_node_id TEXT, x REAL, y REAL, parent_comment_id TEXT, body TEXT NOT NULL, resolved_at TEXT, resolved_by_user_id TEXT, created_by_user_id TEXT NOT NULL, created_by_invite_id TEXT, author_label TEXT, author_role TEXT, created_at TEXT NOT NULL);
  CREATE TABLE layout_finding_state (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_version_id TEXT NOT NULL, finding_key TEXT NOT NULL, status TEXT NOT NULL, assignee_user_id TEXT, note TEXT, updated_by_user_id TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE changelog_draft (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_id TEXT NOT NULL, from_version_id TEXT NOT NULL, to_version_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, statements_json TEXT NOT NULL, evidence_json TEXT NOT NULL, model_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft');
`);

const now = "2026-11-09T00:00:00.000Z";
const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";
const projectA = "10000000-0000-4000-8000-000000000001";
const projectB = "10000000-0000-4000-8000-000000000002";
const handoffA = "20000000-0000-4000-8000-000000000001";
const handoffB = "20000000-0000-4000-8000-000000000002";
const versionA = "30000000-0000-4000-8000-000000000001";
const versionB = "30000000-0000-4000-8000-000000000002";
const versionC = "30000000-0000-4000-8000-000000000003";
const versionD = "30000000-0000-4000-8000-000000000004";
const versionE = "30000000-0000-4000-8000-000000000005";
const versionF = "30000000-0000-4000-8000-000000000006";
const versionG = "30000000-0000-4000-8000-000000000007";
const versionH = "30000000-0000-4000-8000-000000000008";
const versionI = "30000000-0000-4000-8000-000000000009";
const versionJ = "30000000-0000-4000-8000-000000000010";
const frameA = "frame-a";
const measurement = (value, sourceProperty) => ({ value, unit: "px", provenance: "source", sourceProperty });
const fourSidedMeasurements = (top, right, bottom, left) => ({
  top: measurement(top, "padding.top"),
  right: measurement(right, "padding.right"),
  bottom: measurement(bottom, "padding.bottom"),
  left: measurement(left, "padding.left"),
});
const nodeA = {
  sourceNodeId: "button-a",
  parentSourceNodeId: null,
  sourceFrameId: frameA,
  name: "Continue",
  type: "RECTANGLE",
  visible: true,
  bounds: {
    x: measurement(20, "x"),
    y: measurement(30, "y"),
    width: measurement(120, "width"),
    height: measurement(48, "height"),
  },
  layout: { mode: "HORIZONTAL", direction: "LTR", primaryAxisAlign: "CENTER", counterAxisAlign: "CENTER", wrap: false, constraints: {} },
  padding: fourSidedMeasurements(8, 16, 8, 16),
  margins: fourSidedMeasurements(4, 12, 4, 12),
  spacing: {
    rowGap: measurement(8, "rowGap"),
    columnGap: measurement(8, "columnGap"),
    itemGap: measurement(8, "itemGap"),
  },
  fills: [],
  strokes: [],
  styleReferences: [],
  typography: null,
  tokens: [{
    sourceId: "variable/text-primary",
    bindingPath: "fills.0.color",
    category: "color",
    name: "text/primary",
    collectionId: "collection-colors",
    collectionName: "Colors",
    mode: "Light",
    value: "#222222",
  }],
  sourcePayload: {},
};
const snapshot = {
  schemaVersion: 1,
  source: "figma",
  sourceFileId: "file-a",
  sourceRevisionId: null,
  sourceFileName: "Synthetic MCP route fixture",
  capturedAt: now,
  contentHash: "a".repeat(64),
  overviewAssetKey: "render",
  frames: [{
    sourceFrameId: frameA,
    sourcePageId: "page-a",
    name: "Checkout",
    bounds: {
      x: measurement(0, "x"),
      y: measurement(0, "y"),
      width: measurement(320, "width"),
      height: measurement(640, "height"),
    },
    renderAssetKey: "render",
    nodes: [nodeA],
  }],
  assets: [{ key: "render", fileName: "screen.png", contentType: "image/png", sizeBytes: 0, sha256: "b".repeat(64), width: 320, height: 640 }],
  sourceMetadata: { captureScope: "page", sourcePageId: "page-a" },
};
const snapshotB = {
  ...snapshot,
  contentHash: "d".repeat(64),
  frames: [
    ...snapshot.frames,
    {
      ...snapshot.frames[0],
      sourceFrameId: "frame-b",
      name: "Confirm order",
      bounds: {
        x: measurement(0, "x"),
        y: measurement(660, "y"),
        width: measurement(320, "width"),
        height: measurement(640, "height"),
      },
      nodes: [{ ...nodeA, sourceNodeId: "button-b", sourceFrameId: "frame-b", name: "Confirm" }],
    },
  ],
};
const changedNodeC = {
  ...nodeA,
  bounds: {
    ...nodeA.bounds,
    x: measurement(24, "x"),
    width: measurement(140, "width"),
  },
  padding: { ...nodeA.padding, left: measurement(20, "padding.left") },
  tokens: nodeA.tokens.map((token) => ({ ...token, value: "#333333" })),
};
const snapshotC = {
  ...snapshotB,
  contentHash: "e".repeat(64),
  frames: snapshotB.frames.map((frame) => frame.sourceFrameId === frameA
    ? { ...frame, nodes: [changedNodeC] }
    : frame),
};
const unmatchedNode = (sourceNodeId, name) => ({
  ...nodeA,
  sourceNodeId,
  name,
});
const snapshotD = {
  ...snapshot,
  contentHash: "f".repeat(64),
  frames: [{
    ...snapshot.frames[0],
    nodes: [
      unmatchedNode("old-layer-1", "Old layer 1"),
      unmatchedNode("old-layer-2", "Old layer 2"),
      unmatchedNode("old-layer-3", "Old layer 3"),
    ],
  }],
};
const snapshotE = {
  ...snapshotD,
  contentHash: "0".repeat(64),
  frames: [{
    ...snapshotD.frames[0],
    nodes: [
      unmatchedNode("new-layer-1", "New layer 1"),
      unmatchedNode("new-layer-2", "New layer 2"),
      unmatchedNode("new-layer-3", "New layer 3"),
    ],
  }],
};
const snapshotH = {
  ...snapshot,
  contentHash: "3".repeat(64),
  frames: snapshot.frames.map((frame) => ({
    ...frame,
    nodes: frame.nodes.map((node) => ({
      ...node,
      layoutBounds: {
        x: measurement(20.25, "x"),
        y: measurement(30.5, "y"),
        width: measurement(120.75, "width"),
        height: measurement(48, "height"),
      },
    })),
  })),
};
const largeNodes = Array.from({ length: 1_200 }, (_, index) => ({
  ...nodeA,
  sourceNodeId: `stress-${index}`,
  name: `Stress element ${index}`,
  layoutBounds: {
    x: measurement(index + 0.25, "x"),
    y: measurement(index + 0.5, "y"),
    width: measurement(120.75, "width"),
    height: measurement(48, "height"),
  },
  bounds: {
    ...nodeA.bounds,
    x: measurement(index * 2, "x"),
    y: measurement(30, "y"),
    width: measurement(120, "width"),
  },
  sourcePayload: { stressMarker: "x".repeat(1_000) },
}));
const snapshotF = {
  ...snapshot,
  contentHash: "1".repeat(64),
  frames: [{ ...snapshot.frames[0], nodes: largeNodes }],
};
const snapshotG = {
  ...snapshotF,
  contentHash: "2".repeat(64),
  frames: [{
    ...snapshotF.frames[0],
    nodes: snapshotF.frames[0].nodes.map((node) => ({
      ...node,
      layoutBounds: { ...node.layoutBounds, width: measurement(121.25, "width") },
      bounds: { ...node.bounds, width: measurement(121, "width") },
    })),
  }],
};

const emptyRules = JSON.stringify({
  allowedSpacing: [],
  requireTokenCategories: [],
  frameBounds: null,
});

for (const [workspaceId, projectId, handoffId] of [
  [workspaceA, projectA, handoffA],
  [workspaceB, projectB, handoffB],
]) {
  database.prepare("INSERT INTO project (id, workspace_id, name, rules_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(projectId, workspaceId, `Project ${workspaceId.slice(-1)}`, emptyRules, now);
  database.prepare(`INSERT INTO handoff
    (id, workspace_id, project_id, name, created_at, review_share_id)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(handoffId, workspaceId, projectId, "Checkout handoff", now, null);
}

database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  .run(workspaceA, "designer-a", "designer", now);
database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  .run(workspaceB, "designer-b", "designer", now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 1', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionA, workspaceA, handoffA, now, "c".repeat(64), JSON.stringify(snapshot), now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 2', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionB, workspaceA, handoffA, now, snapshotB.contentHash, JSON.stringify(snapshotB), now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 3', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionC, workspaceA, handoffA, now, snapshotC.contentHash, JSON.stringify(snapshotC), now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 4', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionD, workspaceA, handoffA, now, snapshotD.contentHash, JSON.stringify(snapshotD), now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 5', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionE, workspaceA, handoffA, now, snapshotE.contentHash, JSON.stringify(snapshotE), now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 6', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionF, workspaceA, handoffA, now, snapshotF.contentHash, JSON.stringify(snapshotF), now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 7', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionG, workspaceA, handoffA, now, snapshotG.contentHash, JSON.stringify(snapshotG), now);
database.prepare(`INSERT INTO handoff_version
  (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
   source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
  VALUES (?, ?, ?, 'Version 8', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
  .run(versionH, workspaceA, handoffA, now, snapshotH.contentHash, JSON.stringify(snapshotH), now);

const issued = createWorkspaceMcpToken({
  workspaceId: workspaceA,
  createdBy: "designer-a",
  name: "MCP route integration fixture",
  scopes: ["handoffs:read", "tasks:write", "changelog:write"],
  expiresInDays: 1,
});
const readOnlyIssued = createWorkspaceMcpToken({
  workspaceId: workspaceA,
  createdBy: "designer-a",
  name: "MCP read-only integration fixture",
  scopes: ["handoffs:read"],
  expiresInDays: 1,
});

after(() => {
  database.close();
  if (priorDatabase === undefined) delete globalThis.__asbirDatabase;
  else globalThis.__asbirDatabase = priorDatabase;
});

let requestId = 0;
async function callRpc(method, params, {
  token = issued.token,
  workspaceId = workspaceA,
  protocolVersion = LATEST_PROTOCOL_VERSION,
  notification = false,
} = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (protocolVersion) headers["MCP-Protocol-Version"] = protocolVersion;
  const rpcRequest = {
    jsonrpc: "2.0",
    ...(notification ? {} : { id: ++requestId }),
    method,
    ...(params === undefined ? {} : { params }),
  };
  const response = await POST(new Request(`http://localhost:3000/api/mcp?workspaceId=${workspaceId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rpcRequest),
  }));
  if (response.status === 202) return { response, body: null };
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const eventText = await response.text();
    const dataLine = eventText.split("\n").find((line) => line.startsWith("data:"));
    assert.ok(dataLine, eventText);
    return { response, body: JSON.parse(dataLine.slice("data:".length).trim()) };
  }
  return { response, body: await response.json() };
}

async function callTool(name, args, workspaceId = workspaceA) {
  return callRpc("tools/call", { name, arguments: args }, { workspaceId });
}

function parseToolText(body) {
  assert.equal(body.jsonrpc, "2.0");
  assert.ok(body.result, JSON.stringify(body));
  assert.ok(Array.isArray(body.result.content), JSON.stringify(body.result));
  return JSON.parse(body.result.content[0].text);
}

test("an MCP client can initialize, discover read-scoped tools, and read an immutable snapshot", async () => {
  const options = { token: readOnlyIssued.token };
  const initialized = await callRpc("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "asbir-handoff-integration-test", version: "1.0.0" },
  }, { ...options, protocolVersion: null });

  assert.equal(initialized.response.status, 200, JSON.stringify(initialized.body));
  assert.equal(initialized.body.jsonrpc, "2.0");
  assert.equal(initialized.body.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.equal(initialized.body.result.serverInfo.name, "asbir-handoff");
  assert.ok(initialized.body.result.capabilities.tools);

  const ready = await callRpc("notifications/initialized", undefined, {
    ...options,
    protocolVersion: initialized.body.result.protocolVersion,
    notification: true,
  });
  assert.equal(ready.response.status, 202);

  const discovery = await callRpc("tools/list", {}, {
    ...options,
    protocolVersion: initialized.body.result.protocolVersion,
  });
  assert.equal(discovery.response.status, 200, JSON.stringify(discovery.body));
  const toolNames = discovery.body.result.tools.map((tool) => tool.name);
  for (const name of ["list_handoffs", "list_frames", "list_elements", "get_snapshot", "get_measurements", "get_token_bindings", "get_version_diff", "list_comments"]) {
    assert.ok(toolNames.includes(name), `${name} should be discoverable with handoffs:read`);
  }
  assert.ok(!toolNames.includes("link_task"), "read-only clients must not discover task-link writes");
  assert.ok(!toolNames.includes("save_changelog_draft"), "read-only clients must not discover changelog writes");

  const snapshotResponse = await callRpc("tools/call", {
    name: "get_snapshot",
    arguments: { projectId: projectA, handoffId: handoffA, versionId: versionA },
  }, { ...options, protocolVersion: initialized.body.result.protocolVersion });
  assert.equal(snapshotResponse.response.status, 200, JSON.stringify(snapshotResponse.body));
  const snapshotResult = parseToolText(snapshotResponse.body);
  assert.equal(snapshotResult.version.id, versionA);
  assert.equal(snapshotResult.snapshot.frames[0].name, "Checkout");
  assert.equal(snapshotResult.snapshot.frames[0].bounds.width.value, 320);

  const typographyVersionId = "30000000-0000-4000-8000-000000000011";
  const typographySnapshot = structuredClone(snapshot);
  typographySnapshot.frames[0].nodes[0] = {
    ...nodeA,
    type: "TEXT",
    typography: {
      fontFamily: "Inter",
      fontSize: measurement(13, "fontSize"),
      fontWeight: 600,
      lineHeight: { ...measurement(20, "lineHeight"), unit: "pixels" },
      letterSpacing: { ...measurement(0, "letterSpacing"), unit: "pixels" },
      textAlign: "LEFT",
      content: "Departures",
    },
    sourcePayload: {
      textSegments: [{
        characters: "Departures",
        fontName: { family: "Inter", style: "Semi Bold" },
        fontSize: 13,
        fontWeight: 600,
        lineHeight: { unit: "PIXELS", value: 19.5 },
        letterSpacing: { unit: "PIXELS", value: 0.32499998807907104 },
      }],
    },
  };
  database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
     source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, 'Typography precision', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
    .run(typographyVersionId, workspaceA, handoffA, now, typographySnapshot.contentHash, JSON.stringify(typographySnapshot), now);
  const textElements = parseToolText((await callRpc("tools/call", {
    name: "list_elements",
    arguments: { projectId: projectA, handoffId: handoffA, versionId: typographyVersionId, frameId: frameA },
  }, { ...options, protocolVersion: initialized.body.result.protocolVersion })).body);
  assert.equal(textElements.elements[0].typography.lineHeight.value, 19.5);
  assert.equal(textElements.elements[0].typography.letterSpacing.value, 0.32499998807907104);
  database.prepare("DELETE FROM handoff_version WHERE id = ?").run(typographyVersionId);

  const measurementsResponse = await callRpc("tools/call", {
    name: "get_measurements",
    arguments: { projectId: projectA, handoffId: handoffA, versionId: versionH, frameId: frameA, sourceNodeId: nodeA.sourceNodeId },
  }, { ...options, protocolVersion: initialized.body.result.protocolVersion });
  assert.equal(measurementsResponse.response.status, 200, JSON.stringify(measurementsResponse.body));
  const measurements = parseToolText(measurementsResponse.body);
  assert.equal(measurements.bounds.width.value, 120);
  assert.equal(measurements.layoutBounds.x.value, 20.25);
  assert.equal(measurements.layoutBounds.width.value, 120.75);
  assert.equal(measurements.padding.left.value, 16);
  assert.equal(measurements.margins.top.value, 4);
  assert.equal(measurements.spacing.itemGap.value, 8);
  assert.equal(measurements.layout.mode, "HORIZONTAL");

  const tokenBindingsResponse = await callRpc("tools/call", {
    name: "get_token_bindings",
    arguments: { projectId: projectA, handoffId: handoffA, versionId: versionH, frameId: frameA, sourceNodeId: nodeA.sourceNodeId },
  }, { ...options, protocolVersion: initialized.body.result.protocolVersion });
  assert.equal(tokenBindingsResponse.response.status, 200, JSON.stringify(tokenBindingsResponse.body));
  const bindings = parseToolText(tokenBindingsResponse.body).bindings;
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].name, "text/primary");
  assert.equal(bindings[0].value, "#222222");
});

test("MCP returns oversized snapshots as bounded summaries and pages precise element data", async () => {
  const oversized = parseToolText((await callTool("get_snapshot", {
    projectId: projectA,
    handoffId: handoffA,
    versionId: versionF,
  })).body);
  assert.equal(oversized.snapshotOmitted, true);
  assert.ok(oversized.snapshotSizeBytes > 1_048_576);
  assert.equal(oversized.frameCount, 1);
  assert.equal(oversized.elementCount, 1_200);
  assert.match(oversized.readInstructions, /list_elements/);

  const firstPage = parseToolText((await callTool("list_elements", {
    projectId: projectA,
    handoffId: handoffA,
    versionId: versionF,
    frameId: frameA,
    offset: 0,
    limit: 2,
  })).body);
  assert.equal(firstPage.elements.length, 2);
  assert.equal(firstPage.elements[0].sourceNodeId, "stress-0");
  assert.equal(firstPage.elements[0].layoutBounds.x.value, 0.25);
  assert.equal(firstPage.elements[0].layoutBounds.width.value, 120.75);
  assert.equal(firstPage.elements[0].sourcePayload.stressMarker.length, 1_000);
  assert.ok(Buffer.byteLength(JSON.stringify(firstPage), "utf8") < 1_048_576);
  assert.deepEqual(firstPage.page, { offset: 0, limit: 2, total: 1_200, hasMore: true, nextOffset: 2 });

  const lastPage = parseToolText((await callTool("list_elements", {
    projectId: projectA,
    handoffId: handoffA,
    versionId: versionF,
    frameId: frameA,
    offset: 1_199,
    limit: 2,
  })).body);
  assert.equal(lastPage.elements.length, 1);
  assert.equal(lastPage.elements[0].sourceNodeId, "stress-1199");
  assert.equal(lastPage.page.hasMore, false);
  assert.equal(lastPage.page.nextOffset, null);

  const tokenPage = parseToolText((await callTool("get_token_bindings", {
    projectId: projectA,
    handoffId: handoffA,
    versionId: versionF,
    frameId: frameA,
    offset: 0,
    limit: 2,
  })).body);
  assert.equal(tokenPage.bindings.length, 2);
  assert.equal(tokenPage.page.total, 1_200);
  assert.equal(tokenPage.page.hasMore, true);
  assert.equal(tokenPage.page.nextOffset, 2);
});

test("MCP version diffs default to bounded pages for large change sets", async () => {
  const args = { projectId: projectA, handoffId: handoffA, fromVersionId: versionF, toVersionId: versionG };
  const firstPage = parseToolText((await callTool("get_version_diff", args)).body);
  assert.equal(firstPage.changes.length, 100);
  assert.equal(firstPage.changePage.total, 1_200);
  assert.equal(firstPage.changePage.hasMore, true);
  assert.equal(firstPage.changePage.nextOffset, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(firstPage), "utf8") < 250_000);

  const secondPage = parseToolText((await callTool("get_version_diff", { ...args, offset: 100 })).body);
  assert.equal(secondPage.changes.length, 100);
  assert.equal(secondPage.changePage.nextOffset, 200);
  assert.notEqual(firstPage.changes[0].sourceNodeId, secondPage.changes[0].sourceNodeId);
});

test("MCP discovery tools page large project and handoff histories", async () => {
  const extraProjects = 205;
  const insertProject = database.prepare(
    "INSERT INTO project (id, workspace_id, name, rules_json, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertHandoff = database.prepare(
    "INSERT INTO handoff (id, workspace_id, project_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertVersion = database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, source, source_file_id, captured_at,
     content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, 'figma', 'file-a', ?, ?, 0, '{}', 'designer-a', ?)`);

  for (let index = 0; index < extraProjects; index += 1) {
    const suffix = String(index + 1).padStart(12, "0");
    const timestamp = new Date(Date.parse(now) + (index + 1) * 1_000).toISOString();
    insertProject.run(`40000000-0000-4000-8000-${suffix}`, workspaceA, `Large workspace project ${index + 1}`, emptyRules, timestamp);
    insertHandoff.run(`50000000-0000-4000-8000-${suffix}`, workspaceA, projectA, `Large handoff ${index + 1}`, timestamp);
    insertVersion.run(`60000000-0000-4000-8000-${suffix}`, workspaceA, handoffA, `Large version ${index + 1}`, timestamp, `${String(index + 1).padStart(64, "0")}`, timestamp);
  }

  const pages = [
    { name: "list_projects", args: {}, count: extraProjects + 1 },
    { name: "list_handoffs", args: { projectId: projectA }, count: extraProjects + 1 },
    { name: "list_versions", args: { projectId: projectA, handoffId: handoffA }, count: extraProjects + 8 },
  ];

  for (const { name, args, count } of pages) {
    const first = parseToolText((await callTool(name, args)).body);
    const second = parseToolText((await callTool(name, { ...args, offset: 100 })).body);
    const third = parseToolText((await callTool(name, { ...args, offset: 200 })).body);

    assert.equal(first.items.length, 100, `${name} should use a bounded default page`);
    assert.deepEqual(first.page, { offset: 0, limit: 100, total: count, hasMore: true, nextOffset: 100 });
    assert.equal(second.items.length, 100);
    assert.deepEqual(second.page, { offset: 100, limit: 100, total: count, hasMore: true, nextOffset: 200 });
    assert.equal(third.items.length, count - 200);
    assert.deepEqual(third.page, { offset: 200, limit: 100, total: count, hasMore: false, nextOffset: null });
    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    assert.equal(new Set(ids).size, count, `${name} pages should not duplicate records`);
  }
});

test("MCP screens, comments, findings, and linked tasks page every record", async () => {
  const recordCount = 205;
  const manyFrames = Array.from({ length: recordCount }, (_, index) => ({
    ...snapshot.frames[0],
    sourceFrameId: `frame-${String(index).padStart(3, "0")}`,
    name: `Screen ${String(index).padStart(3, "0")}`,
    nodes: [{ ...nodeA, sourceNodeId: `node-${index}`, sourceFrameId: `frame-${String(index).padStart(3, "0")}` }],
  }));
  const pagedSnapshot = { ...snapshot, contentHash: "9".repeat(64), frames: manyFrames };
  const changedFrames = manyFrames.map((frame, index) => ({
    ...frame,
    name: `Updated screen ${String(index).padStart(3, "0")}`,
  }));
  const changedSnapshot = { ...pagedSnapshot, contentHash: "8".repeat(64), frames: changedFrames };
  database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
     source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, 'Version 9', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
    .run(versionI, workspaceA, handoffA, now, pagedSnapshot.contentHash, JSON.stringify(pagedSnapshot), now);
  database.prepare(`INSERT INTO handoff_version
    (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
     source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, 'Version 10', NULL, 'figma', 'file-a', NULL, ?, ?, 0, ?, 'designer-a', ?)`)
    .run(versionJ, workspaceA, handoffA, now, changedSnapshot.contentHash, JSON.stringify(changedSnapshot), now);
  database.prepare("UPDATE project SET rules_json = ? WHERE id = ?")
    .run(JSON.stringify({ allowedSpacing: [999], requireTokenCategories: [], frameBounds: null }), projectA);

  const insertComment = database.prepare(`INSERT INTO handoff_comment
    (id, workspace_id, handoff_version_id, frame_id, source_node_id, x, y,
     parent_comment_id, body, resolved_at, resolved_by_user_id, created_by_user_id, created_at)
    VALUES (?, ?, ?, 'frame-a', NULL, NULL, NULL, NULL, ?, NULL, NULL, 'designer-a', ?)`);
  const insertTask = database.prepare(`INSERT INTO linked_external_task
    (id, workspace_id, handoff_id, version_id, source_system, external_task_id, external_url,
     title, description, evidence_json, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, 'Asbir Teams', ?, NULL, ?, '', '{}', 'designer-a', ?)`);
  database.prepare('INSERT OR IGNORE INTO "user" (id, name) VALUES (?, ?)').run("designer-a", "Designer A");
  for (let index = 0; index < recordCount; index += 1) {
    const suffix = String(index + 1).padStart(12, "0");
    const timestamp = new Date(Date.parse(now) + (index + 1) * 1_000).toISOString();
    insertComment.run(`70000000-0000-4000-8000-${suffix}`, workspaceA, versionA, `Comment ${index + 1}`, timestamp);
    insertComment.run(`71000000-0000-4000-8000-${suffix}`, workspaceA, versionJ, `Latest version comment ${index + 1}`, timestamp);
    insertTask.run(`80000000-0000-4000-8000-${suffix}`, workspaceA, handoffA, versionA, `asbir-${index + 1}`, `Task ${index + 1}`, timestamp);
  }
  database.prepare(`INSERT INTO layout_finding_state
    (id, workspace_id, handoff_version_id, finding_key, status, note, updated_by_user_id, updated_at)
    VALUES (?, ?, ?, ?, 'resolved', 'Reviewed', 'designer-a', ?)`)
    .run(
      "90000000-0000-4000-8000-000000000001",
      workspaceA,
      versionI,
      "spacing.allowed-values:frame-000:node-0:padding.top",
      now,
    );

  const firstFrames = parseToolText((await callTool("list_frames", {
    projectId: projectA, handoffId: handoffA, versionId: versionI,
  })).body);
  const nextFrames = parseToolText((await callTool("list_frames", {
    projectId: projectA, handoffId: handoffA, versionId: versionI, offset: 100,
  })).body);
  const lastFrames = parseToolText((await callTool("list_frames", {
    projectId: projectA, handoffId: handoffA, versionId: versionI, offset: 200,
  })).body);
  assert.equal(firstFrames.frames.length, 100);
  assert.equal(nextFrames.frames.length, 100);
  assert.equal(lastFrames.frames.length, 5);
  assert.deepEqual(firstFrames.page, { offset: 0, limit: 100, total: recordCount, hasMore: true, nextOffset: 100 });
  assert.deepEqual(lastFrames.page, { offset: 200, limit: 100, total: recordCount, hasMore: false, nextOffset: null });

  const firstComments = parseToolText((await callTool("list_comments", {
    projectId: projectA, handoffId: handoffA, versionId: versionA,
  })).body);
  const secondComments = parseToolText((await callTool("list_comments", {
    projectId: projectA, handoffId: handoffA, versionId: versionA, offset: 100,
  })).body);
  const lastComments = parseToolText((await callTool("list_comments", {
    projectId: projectA, handoffId: handoffA, versionId: versionA, offset: 200,
  })).body);
  assert.equal(firstComments.comments.length, 100);
  assert.equal(secondComments.comments.length, 100);
  assert.equal(lastComments.comments.length, 5);
  assert.equal(firstComments.page.total, recordCount);
  assert.equal(lastComments.page.nextOffset, null);

  const firstTasks = parseToolText((await callTool("list_linked_tasks", {
    projectId: projectA, handoffId: handoffA,
  })).body);
  const secondTasks = parseToolText((await callTool("list_linked_tasks", {
    projectId: projectA, handoffId: handoffA, offset: 100,
  })).body);
  const lastTasks = parseToolText((await callTool("list_linked_tasks", {
    projectId: projectA, handoffId: handoffA, offset: 200,
  })).body);
  assert.equal(firstTasks.tasks.length, 100);
  assert.equal(secondTasks.tasks.length, 100);
  assert.equal(lastTasks.tasks.length, 5);
  assert.equal(firstTasks.page.total, recordCount);
  assert.equal(lastTasks.page.nextOffset, null);

  const firstFindings = parseToolText((await callTool("list_findings", {
    projectId: projectA, handoffId: handoffA, versionId: versionI,
  })).body);
  const secondFindings = parseToolText((await callTool("list_findings", {
    projectId: projectA, handoffId: handoffA, versionId: versionI, offset: 100,
  })).body);
  assert.equal(firstFindings.findings.length, 100);
  assert.equal(firstFindings.findingPage.total, recordCount * 11);
  assert.equal(firstFindings.findingPage.nextOffset, 100);
  assert.equal(firstFindings.findings[0].status, "resolved");
  assert.equal(firstFindings.findings[0].note, "Reviewed");
  assert.equal(secondFindings.findings.length, 100);
  assert.equal(secondFindings.findingPage.offset, 100);

  database.prepare("UPDATE project SET rules_json = ? WHERE id = ?").run(JSON.stringify({
    allowedSpacing: [],
    requireTokenCategories: [],
    frameBounds: { minWidth: 321, maxWidth: null, minHeight: null, maxHeight: null },
  }), projectA);
  const diffArgs = { projectId: projectA, handoffId: handoffA, fromVersionId: versionI, toVersionId: versionJ };
  const firstDiffPage = parseToolText((await callTool("get_version_diff", diffArgs)).body);
  const secondDiffPage = parseToolText((await callTool("get_version_diff", {
    ...diffArgs, frameOffset: 100, frameLimit: 100, offset: 100, limit: 50,
  })).body);
  const lastDiffPage = parseToolText((await callTool("get_version_diff", {
    ...diffArgs, frameOffset: 200, frameLimit: 100,
  })).body);
  assert.equal(firstDiffPage.frames.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(firstDiffPage), "utf8") < 250_000);
  assert.deepEqual(firstDiffPage.framePage, { offset: 0, limit: 100, total: recordCount, hasMore: true, nextOffset: 100 });
  assert.equal(secondDiffPage.frames.length, 100);
  assert.deepEqual(secondDiffPage.framePage, { offset: 100, limit: 100, total: recordCount, hasMore: true, nextOffset: 200 });
  assert.equal(secondDiffPage.changePage.offset, 100);
  assert.equal(secondDiffPage.changePage.limit, 50);
  assert.equal(lastDiffPage.frames.length, 5);
  assert.deepEqual(lastDiffPage.framePage, { offset: 200, limit: 100, total: recordCount, hasMore: false, nextOffset: null });

  const evidenceArgs = { ...diffArgs, limit: 100 };
  let evidencePage = parseToolText((await callTool("get_changelog_evidence", evidenceArgs)).body);
  assert.equal(evidencePage.evidence.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(evidencePage), "utf8") < 250_000);
  assert.equal(evidencePage.evidencePage.total > recordCount, true);
  assert.equal(evidencePage.evidencePage.nextOffset, 100);
  const evidence = [...evidencePage.evidence];
  while (evidencePage.evidencePage.hasMore) {
    evidencePage = parseToolText((await callTool("get_changelog_evidence", {
      ...evidenceArgs,
      offset: evidencePage.evidencePage.nextOffset,
    })).body);
    evidence.push(...evidencePage.evidence);
  }
  assert.equal(evidence.length, evidencePage.evidencePage.total);
  assert.equal(new Set(evidence.map((item) => item.id)).size, evidence.length);
  assert.equal(evidence.filter((item) => item.kind === "frame").length, recordCount);
  assert.equal(evidence.filter((item) => item.kind === "comment").length, recordCount);
  assert.equal(evidence.filter((item) => item.kind === "finding").length, recordCount);

  database.prepare("DELETE FROM handoff_comment WHERE id LIKE '70000000-0000-4000-8000-%'").run();
  database.prepare("DELETE FROM handoff_comment WHERE id LIKE '71000000-0000-4000-8000-%'").run();
  database.prepare("DELETE FROM linked_external_task WHERE id LIKE '80000000-0000-4000-8000-%'").run();
  database.prepare("DELETE FROM layout_finding_state WHERE id = ?").run("90000000-0000-4000-8000-000000000001");
  database.prepare("DELETE FROM handoff_version WHERE id = ?").run(versionI);
  database.prepare("DELETE FROM handoff_version WHERE id = ?").run(versionJ);
  database.prepare("UPDATE project SET rules_json = ? WHERE id = ?").run(emptyRules, projectA);
});

test("MCP version diffs default to bounded results and can page a focused screen", async () => {
  const args = { projectId: projectA, handoffId: handoffA, fromVersionId: versionA, toVersionId: versionC };
  const fullResponse = await callTool("get_version_diff", args);
  assert.equal(fullResponse.response.status, 200);
  const full = parseToolText(fullResponse.body);
  assert.equal(full.frames.length, 2);
  assert.equal(full.changes.length, 5);
  assert.deepEqual(full.changePage, {
    frameId: null,
    offset: 0,
    limit: 100,
    total: 5,
    hasMore: false,
    nextOffset: null,
  });

  const firstResponse = await callTool("get_version_diff", { ...args, frameId: frameA, offset: 0, limit: 2 });
  assert.equal(firstResponse.response.status, 200);
  const first = parseToolText(firstResponse.body);
  assert.deepEqual(first.frames.map((frame) => frame.frameId), [frameA]);
  assert.equal(first.changes.length, 2);
  assert.deepEqual(first.changePage, {
    frameId: frameA,
    offset: 0,
    limit: 2,
    total: 4,
    hasMore: true,
    nextOffset: 2,
  });

  const secondResponse = await callTool("get_version_diff", { ...args, frameId: frameA, offset: 2, limit: 2 });
  const second = parseToolText(secondResponse.body);
  assert.equal(second.changes.length, 2);
  assert.equal(second.changePage.total, 4);
  assert.equal(second.changePage.hasMore, false);
  assert.equal(second.changePage.nextOffset, null);
  assert.equal(new Set([...first.changes, ...second.changes].map((change) => change.path)).size, 4);

  const missingScreen = await callTool("get_version_diff", { ...args, frameId: "missing-screen", limit: 2 });
  assert.equal(missingScreen.body.result.isError, true);
  assert.match(missingScreen.body.result.content[0].text, /Screen not found in these versions/);

  const excessivePage = await callTool("get_version_diff", { ...args, limit: 501 });
  assert.equal(excessivePage.body.result.isError, true);
});

test("MCP version diff pages bound unmatched-layer suggestions too", async () => {
  const args = { projectId: projectA, handoffId: handoffA, fromVersionId: versionD, toVersionId: versionE, frameId: frameA };
  const first = parseToolText((await callTool("get_version_diff", { ...args, offset: 0, limit: 2 })).body);
  assert.equal(first.unmatchedNodeCandidates.length, 2);
  assert.deepEqual(first.unmatchedNodeCandidatePage, {
    offset: 0,
    limit: 2,
    total: 3,
    hasMore: true,
    nextOffset: 2,
  });

  const second = parseToolText((await callTool("get_version_diff", { ...args, offset: 2, limit: 2 })).body);
  assert.equal(second.unmatchedNodeCandidates.length, 1);
  assert.equal(second.unmatchedNodeCandidatePage.total, 3);
  assert.equal(second.unmatchedNodeCandidatePage.hasMore, false);
  assert.equal(second.unmatchedNodeCandidatePage.nextOffset, null);
});

test("the MCP HTTP route links an external task to an exact version and enforces workspace scope", async () => {
  const link = await callTool("link_task", {
    projectId: projectA,
    handoffId: handoffA,
    versionId: versionA,
    sourceSystem: "ClickUp",
    externalTaskId: "task-123",
    externalUrl: "https://app.clickup.com/t/task-123",
    title: "Review checkout spacing",
    description: "Check the captured checkout spacing before release.",
    frameId: frameA,
  });

  assert.equal(link.response.status, 200);
  assert.equal(link.body.result.isError, undefined);
  const linkedTask = parseToolText(link.body);
  assert.equal(linkedTask.sourceSystem, "ClickUp");
  assert.equal(linkedTask.externalTaskId, "task-123");
  assert.equal(linkedTask.versionId, versionA);
  assert.equal(linkedTask.evidence.versionId, versionA);
  assert.equal(linkedTask.evidence.designContext.frame.sourceFrameId, frameA);
  assert.match(linkedTask.evidence.handoffUrl, new RegExp(`versionId=${versionA}#screen=${frameA}$`));

  const asbirTeamsLink = await callTool("link_task", {
    projectId: projectA,
    handoffId: handoffA,
    versionId: versionB,
    sourceSystem: "Asbir Teams",
    externalTaskId: "team-task-42",
    title: "Review checkout handoff",
    description: "Review the checkout flow against the captured design.",
    frameId: frameA,
  });
  assert.equal(asbirTeamsLink.response.status, 200);
  assert.equal(asbirTeamsLink.body.result.isError, undefined);
  const asbirTeamsTask = parseToolText(asbirTeamsLink.body);
  assert.equal(asbirTeamsTask.sourceSystem, "Asbir Teams");
  assert.equal(asbirTeamsTask.externalTaskId, "team-task-42");
  assert.equal(asbirTeamsTask.versionId, versionB);
  assert.equal(asbirTeamsTask.evidence.versionId, versionB);
  assert.equal(asbirTeamsTask.evidence.contentHash, "d".repeat(64));

  const listed = await callTool("list_linked_tasks", { projectId: projectA, handoffId: handoffA });
  assert.equal(listed.response.status, 200);
  const tasks = parseToolText(listed.body);
  assert.equal(tasks.tasks.length, 2);
  assert.equal(tasks.page.total, 2);
  const listedClickUpTask = tasks.tasks.find((task) => task.id === linkedTask.id);
  assert.ok(listedClickUpTask);
  assert.equal(listedClickUpTask.sourceSystem, "ClickUp");
  assert.equal(listedClickUpTask.versionId, versionA);
  assert.equal(listedClickUpTask.evidence.contentHash, "c".repeat(64));
  const listedAsbirTeamsTask = tasks.tasks.find((task) => task.id === asbirTeamsTask.id);
  assert.ok(listedAsbirTeamsTask);
  assert.equal(listedAsbirTeamsTask.sourceSystem, "Asbir Teams");
  assert.equal(listedAsbirTeamsTask.versionId, versionB);
  assert.equal(listedAsbirTeamsTask.evidence.contentHash, "d".repeat(64));

  const crossWorkspace = await callTool("list_linked_tasks", { projectId: projectB, handoffId: handoffB });
  assert.equal(crossWorkspace.response.status, 200);
  assert.equal(crossWorkspace.body.result.isError, true);
  assert.match(crossWorkspace.body.result.content[0].text, /Handoff not found in this workspace/);

  const mismatchedWorkspaceResponse = await POST(new Request(`http://localhost:3000/api/mcp?workspaceId=${workspaceB}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${issued.token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name: "list_linked_tasks", arguments: { projectId: projectA, handoffId: handoffA } } }),
  }));
  assert.equal(mismatchedWorkspaceResponse.status, 403);
  assert.match((await mismatchedWorkspaceResponse.json()).error, /does not belong to the workspace in this URL/);
});

test("a connected AI client can save a draft with current version-pair evidence only", async () => {
  const pair = { projectId: projectA, handoffId: handoffA, fromVersionId: versionA, toVersionId: versionB };
  const evidenceResponse = await callTool("get_changelog_evidence", pair);
  assert.equal(evidenceResponse.response.status, 200);
  assert.equal(evidenceResponse.body.result.isError, undefined);
  const evidenceResult = parseToolText(evidenceResponse.body);
  assert.deepEqual(evidenceResult.fromVersion, { id: versionA, label: "Version 1" });
  assert.deepEqual(evidenceResult.toVersion, { id: versionB, label: "Version 2" });

  const addedFrameEvidence = evidenceResult.evidence.find((item) => item.kind === "frame" && item.frameId === "frame-b");
  assert.ok(addedFrameEvidence, "the new screen should be available as draft evidence");
  assert.match(addedFrameEvidence.details, /is new between versions Version 1 and Version 2/);

  const draftInput = {
    ...pair,
    title: "Checkout flow update",
    summary: "A confirmation screen was added.",
    statements: [{ audience: "developer", text: "Add the order confirmation screen.", evidence: [addedFrameEvidence.id] }],
  };
  const savedResponse = await callTool("save_changelog_draft", draftInput);
  assert.equal(savedResponse.response.status, 200);
  assert.equal(savedResponse.body.result.isError, undefined);
  const savedDraft = parseToolText(savedResponse.body);
  assert.equal(savedDraft.status, "draft");
  assert.equal(savedDraft.model, "Connected AI client");
  assert.equal(savedDraft.fromVersionId, versionA);
  assert.equal(savedDraft.toVersionId, versionB);
  assert.deepEqual(savedDraft.evidence.map((item) => item.id), [addedFrameEvidence.id]);
  assert.equal(savedDraft.evidence[0].versionId, versionB);

  const invalidResponse = await callTool("save_changelog_draft", {
    ...draftInput,
    statements: [{ audience: "developer", text: "Invented claim.", evidence: ["frame:file-a:not-a-real-frame"] }],
  });
  assert.equal(invalidResponse.response.status, 200);
  assert.equal(invalidResponse.body.result.isError, true);
  assert.match(invalidResponse.body.result.content[0].text, /evidence IDs that are not available/);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM changelog_draft WHERE handoff_id = ?").get(handoffA).count, 1);
});

test("a connected AI client can save evidence from reviewer-confirmed screen and layer matches", async () => {
  const beforeFrameId = "legacy-checkout-frame";
  const afterFrameId = "renamed-checkout-frame";
  const beforeSnapshot = {
    ...snapshotD,
    frames: snapshotD.frames.map((frame) => ({
      ...frame,
      sourceFrameId: beforeFrameId,
      name: "Checkout · legacy",
      nodes: frame.nodes.map((node) => ({ ...node, sourceFrameId: beforeFrameId })),
    })),
  };
  const afterSnapshot = {
    ...snapshotE,
    frames: snapshotE.frames.map((frame) => ({
      ...frame,
      sourceFrameId: afterFrameId,
      name: "Checkout · refreshed",
      nodes: frame.nodes.map((node) => node.sourceNodeId === "new-layer-1"
        ? { ...node, sourceFrameId: afterFrameId, bounds: { ...node.bounds, width: measurement(140, "width") } }
        : { ...node, sourceFrameId: afterFrameId }),
    })),
  };
  database.prepare("UPDATE handoff_version SET snapshot_json = ? WHERE id = ?")
    .run(JSON.stringify(beforeSnapshot), versionD);
  database.prepare("UPDATE handoff_version SET snapshot_json = ? WHERE id = ?")
    .run(JSON.stringify(afterSnapshot), versionE);
  database.prepare(`INSERT INTO handoff_frame_replacement
    (handoff_id, workspace_id, baseline_version_id, new_version_id,
     before_frame_id, after_frame_id, confirmed_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(handoffA, workspaceA, versionD, versionE, beforeFrameId, afterFrameId, "designer-a", now);
  database.prepare(`INSERT INTO handoff_node_replacement
    (handoff_id, workspace_id, baseline_version_id, new_version_id,
     before_frame_id, after_frame_id, before_node_id, after_node_id,
     confirmed_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(handoffA, workspaceA, versionD, versionE, beforeFrameId, afterFrameId, "old-layer-1", "new-layer-1", "designer-a", now);

  const pair = { projectId: projectA, handoffId: handoffA, fromVersionId: versionD, toVersionId: versionE };
  const evidenceResponse = await callTool("get_changelog_evidence", pair);
  assert.equal(evidenceResponse.body.result.isError, undefined);
  const evidenceItems = parseToolText(evidenceResponse.body).evidence;
  const evidence = evidenceItems.find((item) =>
    item.kind === "diff" && item.sourceNodeId === "old-layer-1" && item.path === "bounds.width.value",
  );
  assert.ok(evidence, "the confirmed screen and layer matches should produce citeable change evidence");

  const savedResponse = await callTool("save_changelog_draft", {
    ...pair,
    title: "Updated layer dimensions",
    summary: "A confirmed layer changed size.",
    statements: [{ audience: "developer", text: "Update the matched layer width.", evidence: [evidence.id] }],
  });
  assert.equal(savedResponse.body.result.isError, undefined, savedResponse.body.result.content?.[0]?.text);
  const saved = parseToolText(savedResponse.body);
  assert.deepEqual(saved.evidence.map((item) => item.id), [evidence.id]);
});
