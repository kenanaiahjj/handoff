import type { StoredSnapshot } from "../repositories/versions";
import { listHandoffComments } from "../repositories/comments";
import { evaluateLayoutRules } from "../services/layout-rules";
import { diffSnapshots } from "../services/diff";
import { generateChangelog } from "./openai-provider";
import type { EvidenceRef } from "./schema";

type VersionInput = {
  id: string;
  versionLabel: string;
  snapshot: StoredSnapshot;
};

export type DraftEvidence = EvidenceRef & { content: string };

function clipped(value: unknown, maxLength = 600) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const text = serialized ?? "Unavailable";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function frameName(snapshot: StoredSnapshot, frameId: string) {
  return snapshot.frames.find((frame) => frame.sourceFrameId === frameId)?.name ?? frameId;
}

export function collectChangelogEvidence(input: {
  workspaceId: string;
  handoffId: string;
  from: VersionInput;
  to: VersionInput;
  rules: Parameters<typeof evaluateLayoutRules>[1];
}) {
  const diff = diffSnapshots(
    { versionId: input.from.id, snapshot: input.from.snapshot },
    { versionId: input.to.id, snapshot: input.to.snapshot },
  );
  const evidence: DraftEvidence[] = [];

  for (const frame of diff.frames) {
    const versionId = frame.status === "removed" ? input.from.id : input.to.id;
    const id = `frame:${encodeURIComponent(frame.sourceFileId)}:${encodeURIComponent(frame.frameId)}`;
    evidence.push({
      id,
      kind: "frame",
      label: `${frameStatus(frame.status)} · ${frame.name}`,
      details: `Frame ${frame.frameId} is ${frame.status} between versions ${input.from.versionLabel} and ${input.to.versionLabel}.`,
      versionId,
      frameId: frame.frameId,
      sourceNodeId: null,
      path: null,
      content: `Frame status: ${frame.status}. Name: ${frame.name}.`,
    });
  }

  for (const [index, change] of diff.changes.slice(0, 160).entries()) {
    const id = `diff:${encodeURIComponent(change.sourceFileId)}:${encodeURIComponent(change.frameId)}:${encodeURIComponent(change.sourceNodeId ?? "frame")}:${encodeURIComponent(change.path)}`;
    evidence.push({
      id,
      kind: "diff",
      label: `${frameName(input.to.snapshot, change.frameId)} · ${change.category} · ${change.path}`,
      details: `${change.category} change from ${clipped(change.before)} to ${clipped(change.after)}.`,
      versionId: input.to.id,
      frameId: change.frameId,
      sourceNodeId: change.sourceNodeId,
      path: change.path,
      content: `${index + 1}. ${change.category} ${change.path}: before=${clipped(change.before)}; after=${clipped(change.after)}; frame=${frameName(input.to.snapshot, change.frameId)}; node=${change.sourceNodeId ?? "frame"}.`,
    });
  }

  const evaluated = evaluateLayoutRules(input.to.snapshot, input.rules);
  for (const finding of evaluated.findings.slice(0, 50)) {
    evidence.push({
      id: `finding:${finding.findingKey}`,
      kind: "finding",
      label: `${finding.frameName} · ${finding.ruleId}`,
      details: finding.summary,
      versionId: input.to.id,
      frameId: finding.frameId,
      sourceNodeId: finding.sourceNodeId,
      path: finding.path,
      content: `Layout finding: ${finding.summary} Actual=${clipped(finding.actual)} Expected=${clipped(finding.expected)}.`,
    });
  }

  const commentRows = listHandoffComments({ workspaceId: input.workspaceId, versionId: input.to.id }) as Array<{
    id: string;
    frameId: string;
    sourceNodeId: string | null;
    parentCommentId: string | null;
    body: string;
    resolvedAt: string | null;
  }>;
  for (const comment of commentRows.slice(0, 20)) {
    evidence.push({
      id: `comment:${comment.id}`,
      kind: "comment",
      label: `${frameName(input.to.snapshot, comment.frameId)} · team comment`,
      details: comment.body,
      versionId: input.to.id,
      frameId: comment.frameId,
      sourceNodeId: comment.sourceNodeId,
      path: null,
      content: `Team comment${comment.parentCommentId ? " reply" : ""} (${comment.resolvedAt ? "resolved" : "open"}): ${clipped(comment.body)}.`,
    });
  }

  return evidence.slice(0, 200);
}

export async function createEvidenceLinkedDraft(input: {
  workspaceId: string;
  handoffId: string;
  handoffName: string;
  from: VersionInput;
  to: VersionInput;
  rules: Parameters<typeof evaluateLayoutRules>[1];
}) {
  const usableEvidence = collectChangelogEvidence(input);
  const generated = await generateChangelog({
    handoffName: input.handoffName,
    fromVersionLabel: input.from.versionLabel,
    toVersionLabel: input.to.versionLabel,
    evidence: usableEvidence.map(({ id, kind, label, content }) => ({ id, kind, label, details: content })),
  });
  const evidenceIds = new Set(usableEvidence.map((item) => item.id));
  for (const statement of generated.content.statements) {
    if (statement.evidence.some((id) => !evidenceIds.has(id))) {
      throw new Error("The generated draft referenced evidence that was not part of this handoff.");
    }
  }

  const evidenceMap = new Map(usableEvidence.map((item) => [item.id, item]));
  return {
    title: generated.content.title,
    summary: generated.content.summary,
    statements: generated.content.statements,
    evidence: generated.content.statements.flatMap((statement) => statement.evidence)
      .map((id) => evidenceMap.get(id)!)
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .map(({ content: _content, ...item }) => item),
    model: generated.model,
  };
}

function frameStatus(status: "added" | "removed" | "changed" | "unchanged") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
