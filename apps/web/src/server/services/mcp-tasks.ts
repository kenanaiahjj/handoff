import type { SnapshotNode } from "@asbir/snapshot-contract";
import { codeStyle, cssText } from "./mcp-css";
import { componentIdentity, type ScreenChangeSummary } from "./mcp-dev";
import type { ImplementationLink } from "../repositories/implementation-links";
import type { ImplementationProgress } from "../repositories/implementation-progress";

/**
 * A handoff's design changes as a developer's to-do list: one task per removed, added, moved or
 * edited layer (and per new or removed screen), each with the code-ready CSS to apply, the code
 * file linked to it, and the progress recorded so far. Task ids are stable for a version, so an
 * AI can mark them done with report_progress.
 */

export type ImplementationTask = {
  taskId: string;
  kind: "build-screen" | "remove-screen" | "add" | "remove" | "move" | "update";
  screen: { frameId: string; name: string };
  layer: { id: string; name: string; type: string } | null;
  summary: string;
  changes?: Array<{ field: string; from: unknown; to: unknown }>;
  css?: string;
  tokens?: Record<string, string>;
  notes?: string[];
  text?: string | null;
  childCount?: number;
  code: Array<{ codePath: string; codeComponent: string | null; via: "component" | "element" }>;
  status: ImplementationProgress["status"];
  progress: Pick<ImplementationProgress, "codePath" | "note" | "updatedAt"> | null;
};

export const taskId = (frameId: string, kind: ImplementationTask["kind"], nodeId?: string) => [frameId, kind, nodeId].filter(Boolean).join("|");

function styleFor(node: SnapshotNode | undefined, byId: Map<string, SnapshotNode>) {
  if (!node) return {};
  const style = codeStyle(node, node.parentSourceNodeId ? byId.get(node.parentSourceNodeId) : null);
  const tokens = Object.fromEntries(Object.entries(style.tokens).map(([property, token]) => [property, `${token.token} (${token.cssVar})`]));
  return {
    css: cssText(style),
    ...(Object.keys(tokens).length ? { tokens } : {}),
    ...(style.notes.length ? { notes: style.notes } : {}),
  };
}

function codeFor(node: SnapshotNode | undefined, links: ImplementationLink[]) {
  if (!node) return [];
  const identity = componentIdentity(node);
  return links
    .filter((link) => (link.targetKind === "element" && link.targetId === node.sourceNodeId) || (identity && link.targetKind === "component" && link.targetId === identity.componentId))
    .map((link) => ({ codePath: link.codePath, codeComponent: link.codeComponent, via: link.targetKind }));
}

/** Tasks for one changed, added or removed screen. */
export function screenTasks(input: {
  frameId: string;
  name: string;
  status: "changed" | "added" | "removed";
  summary: ScreenChangeSummary | null;
  beforeNodes: SnapshotNode[];
  afterNodes: SnapshotNode[];
  links: ImplementationLink[];
  progress: Map<string, ImplementationProgress>;
}): ImplementationTask[] {
  const screen = { frameId: input.frameId, name: input.name };
  const afterById = new Map(input.afterNodes.map((node) => [node.sourceNodeId, node]));
  const beforeById = new Map(input.beforeNodes.map((node) => [node.sourceNodeId, node]));
  const withProgress = (task: Omit<ImplementationTask, "status" | "progress">): ImplementationTask => {
    const saved = input.progress.get(task.taskId);
    return { ...task, status: saved?.status ?? "todo", progress: saved ? { codePath: saved.codePath, note: saved.note, updatedAt: saved.updatedAt } : null };
  };

  if (input.status === "added") {
    const root = input.afterNodes.find((node) => node.sourceNodeId === input.frameId) ?? input.afterNodes[0];
    return [withProgress({
      taskId: taskId(input.frameId, "build-screen"),
      kind: "build-screen",
      screen,
      layer: root ? { id: root.sourceNodeId, name: root.name, type: root.type } : null,
      summary: `New screen "${input.name}" (${input.afterNodes.length} layers). Use get_frame for its outline, get_element for each part and get_element_image for icons and images.`,
      ...styleFor(root, afterById),
      code: codeFor(root, input.links),
    })];
  }
  if (input.status === "removed") {
    return [withProgress({
      taskId: taskId(input.frameId, "remove-screen"),
      kind: "remove-screen",
      screen,
      layer: null,
      summary: `Screen "${input.name}" was removed from the design.`,
      code: codeFor(input.beforeNodes.find((node) => node.sourceNodeId === input.frameId), input.links),
    })];
  }

  const summary = input.summary;
  if (!summary) return [];
  const tasks: ImplementationTask[] = [];
  for (const removed of summary.removed) {
    tasks.push(withProgress({
      taskId: taskId(input.frameId, "remove", removed.id),
      kind: "remove",
      screen,
      layer: { id: removed.id, name: removed.name, type: removed.type },
      summary: `Remove "${removed.name}"${removed.childCount ? ` and its ${removed.childCount} child layers` : ""}.`,
      text: removed.text,
      childCount: removed.childCount,
      code: codeFor(beforeById.get(removed.id), input.links),
    }));
  }
  for (const added of summary.added) {
    const node = afterById.get(added.id);
    const parent = node?.parentSourceNodeId ? afterById.get(node.parentSourceNodeId) : undefined;
    tasks.push(withProgress({
      taskId: taskId(input.frameId, "add", added.id),
      kind: "add",
      screen,
      layer: { id: added.id, name: added.name, type: added.type },
      summary: `Add "${added.name}" (${added.type.toLowerCase()}${added.childCount ? `, ${added.childCount} child layers` : ""})${parent ? ` inside "${parent.name}"` : ""}. Use get_element and list_elements with parentId "${added.id}" for its parts.`,
      text: added.text,
      childCount: added.childCount,
      ...styleFor(node, afterById),
      code: codeFor(node, input.links),
    }));
  }
  for (const moved of summary.moved) {
    const node = afterById.get(moved.id);
    const name = (id: unknown) => (typeof id === "string" ? afterById.get(id)?.name ?? beforeById.get(id)?.name ?? id : String(id));
    tasks.push(withProgress({
      taskId: taskId(input.frameId, "move", moved.id),
      kind: "move",
      screen,
      layer: { id: moved.id, name: moved.name, type: moved.type },
      summary: `Move "${moved.name}" from "${name(moved.from)}" into "${name(moved.to)}".`,
      ...styleFor(node, afterById),
      code: codeFor(node, input.links),
    }));
  }
  for (const edited of summary.edited) {
    const node = afterById.get(edited.id);
    tasks.push(withProgress({
      taskId: taskId(input.frameId, "update", edited.id),
      kind: "update",
      screen,
      layer: { id: edited.id, name: edited.name, type: edited.type },
      summary: `Update "${edited.name}": ${edited.changes.slice(0, 4).map((change) => `${change.field} ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`).join("; ")}${edited.changes.length > 4 ? `; +${edited.changes.length - 4} more` : ""}.`,
      changes: edited.changes.map(({ field, from, to }) => ({ field, from, to })),
      ...styleFor(node, afterById),
      code: codeFor(node, input.links),
    }));
  }
  return tasks;
}
