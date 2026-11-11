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
  CREATE TABLE handoff_comment (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, handoff_version_id TEXT NOT NULL, frame_id TEXT NOT NULL, source_node_id TEXT, x REAL, y REAL, parent_comment_id TEXT, body TEXT NOT NULL, resolved_at TEXT, resolved_by_user_id TEXT, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
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
  for (const name of ["list_handoffs", "list_frames", "get_snapshot", "get_measurements", "get_token_bindings", "get_version_diff", "list_comments"]) {
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

  const measurementsResponse = await callRpc("tools/call", {
    name: "get_measurements",
    arguments: { projectId: projectA, handoffId: handoffA, versionId: versionA, frameId: frameA, sourceNodeId: nodeA.sourceNodeId },
  }, { ...options, protocolVersion: initialized.body.result.protocolVersion });
  assert.equal(measurementsResponse.response.status, 200, JSON.stringify(measurementsResponse.body));
  const measurements = parseToolText(measurementsResponse.body);
  assert.equal(measurements.bounds.width.value, 120);
  assert.equal(measurements.padding.left.value, 16);
  assert.equal(measurements.margins.top.value, 4);
  assert.equal(measurements.spacing.itemGap.value, 8);
  assert.equal(measurements.layout.mode, "HORIZONTAL");

  const tokenBindingsResponse = await callRpc("tools/call", {
    name: "get_token_bindings",
    arguments: { projectId: projectA, handoffId: handoffA, versionId: versionA, frameId: frameA, sourceNodeId: nodeA.sourceNodeId },
  }, { ...options, protocolVersion: initialized.body.result.protocolVersion });
  assert.equal(tokenBindingsResponse.response.status, 200, JSON.stringify(tokenBindingsResponse.body));
  const bindings = parseToolText(tokenBindingsResponse.body).bindings;
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].name, "text/primary");
  assert.equal(bindings[0].value, "#222222");
});

test("MCP version diffs can return a focused, paginated screen while preserving full responses", async () => {
  const args = { projectId: projectA, handoffId: handoffA, fromVersionId: versionA, toVersionId: versionC };
  const fullResponse = await callTool("get_version_diff", args);
  assert.equal(fullResponse.response.status, 200);
  const full = parseToolText(fullResponse.body);
  assert.equal(full.frames.length, 2);
  assert.equal(full.changes.length, 5);
  assert.equal(full.changePage, undefined);

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
  assert.equal(tasks.length, 2);
  const listedClickUpTask = tasks.find((task) => task.id === linkedTask.id);
  assert.ok(listedClickUpTask);
  assert.equal(listedClickUpTask.sourceSystem, "ClickUp");
  assert.equal(listedClickUpTask.versionId, versionA);
  assert.equal(listedClickUpTask.evidence.contentHash, "c".repeat(64));
  const listedAsbirTeamsTask = tasks.find((task) => task.id === asbirTeamsTask.id);
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
