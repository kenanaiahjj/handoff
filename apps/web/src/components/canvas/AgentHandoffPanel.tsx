"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { SnapshotNode } from "@asbir/snapshot-contract";
import { codexMcpConfiguration, genericMcpConfiguration, workspaceMcpEndpoint } from "../integrations/mcp-configuration";
import type { CanvasFrameOption } from "./FrameNavigator";
import type { VersionOption } from "./VersionCompare";

type LinkedTask = {
  id: string;
  versionId: string;
  externalTaskId: string | null;
  externalUrl: string | null;
  agentRunUrl: string | null;
  pullRequestUrl: string | null;
  title: string;
  description: string;
  sourceSystem: string;
  createdAt: string;
};

type AgentScope = "comments:write" | "tasks:write" | "changelog:write";
type TaskListPayload = { tasks: LinkedTask[] };
type ComparePayload = {
  diff: {
    frames: Array<{ frameId: string; status: string }>;
    changes: Array<{
      frameId: string;
      sourceNodeId: string | null;
      path: string;
      before: unknown;
      after: unknown;
      category: string;
    }>;
  };
};
type CommentsPayload = { comments: Array<Record<string, unknown> & { frameId: string }> };
type FindingsPayload = { findings: Array<Record<string, unknown> & { frameId?: string }> };
type ChangelogPayload = {
  drafts: Array<{
    id: string;
    toVersionId: string;
    status: "draft" | "approved";
    title: string;
    summary: string;
    statements: unknown[];
  }>;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Could not load handoff context.");
  return payload;
}

function serializeNode(node: SnapshotNode) {
  return {
    sourceNodeId: node.sourceNodeId,
    parentSourceNodeId: node.parentSourceNodeId,
    sourceFrameId: node.sourceFrameId,
    name: node.name,
    type: node.type,
    visible: node.visible,
    bounds: node.bounds,
    layout: node.layout,
    padding: node.padding,
    margins: node.margins,
    spacing: node.spacing,
    fills: node.fills,
    strokes: node.strokes,
    styleReferences: node.styleReferences,
    typography: node.typography,
    tokens: node.tokens,
  };
}

export function AgentHandoffPanel({ input }: {
  input: {
    workspaceId: string;
    projectId: string;
    handoffId: string;
    versionId: string;
    versionLabel: string;
    contentHash: string;
    source: string;
    sourceRevisionId: string | null;
    releaseNote: string | null;
    reviewHref: string;
    integrationHref: string | null;
    canManageIntegrations: boolean;
    versions: VersionOption[];
    frames: CanvasFrameOption[];
    initialFrameId: string | null;
    initialNodeId: string | null;
  };
}) {
  const routeBase = `/api/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/handoffs/${encodeURIComponent(input.handoffId)}`;
  const tasksEndpoint = `${routeBase}/tasks`;
  const screenOptions = useMemo(() => input.frames.filter((frame) => frame.kind === "frame"), [input.frames]);
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [frameId, setFrameId] = useState(() => input.initialFrameId ?? screenOptions[0]?.id ?? "");
  const [nodeId, setNodeId] = useState(() => input.initialNodeId ?? "");
  const [criteria, setCriteria] = useState("");
  const [scopes, setScopes] = useState<AgentScope[]>([]);
  const [newTaskSourceSystem, setNewTaskSourceSystem] = useState("");
  const [newTaskExternalId, setNewTaskExternalId] = useState("");
  const [newTaskExternalUrl, setNewTaskExternalUrl] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [agentLinkEdits, setAgentLinkEdits] = useState<Record<string, { agentRunUrl: string; pullRequestUrl: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingTask, setSavingTask] = useState(false);
  const [savingAgentLinks, setSavingAgentLinks] = useState(false);
  const [buildingBrief, setBuildingBrief] = useState(false);
  const [brief, setBrief] = useState("");
  const [setupPreview, setSetupPreview] = useState<{ label: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedFrame = screenOptions.find((frame) => frame.id === frameId) ?? null;
  const selectedNode = selectedFrame?.nodes.find((node) => node.sourceNodeId === nodeId) ?? null;
  const versionIndex = input.versions.findIndex((version) => version.id === input.versionId);
  const baseline = versionIndex >= 0 ? input.versions[versionIndex + 1] ?? null : null;
  const matchingTasks = tasks.filter((task) => task.versionId === input.versionId);
  const selectedTask = matchingTasks.find((task) => task.id === taskId) ?? null;
  const selectedTaskLinks = selectedTask
    ? agentLinkEdits[selectedTask.id] ?? { agentRunUrl: selectedTask.agentRunUrl ?? "", pullRequestUrl: selectedTask.pullRequestUrl ?? "" }
    : { agentRunUrl: "", pullRequestUrl: "" };
  const nodeTokenBindings = selectedFrame?.nodes.flatMap((node) => node.tokens.map((token) => ({
    sourceNodeId: node.sourceNodeId,
    elementName: node.name,
    token,
  }))) ?? [];

  useEffect(() => {
    let active = true;
    readJson<TaskListPayload>(tasksEndpoint)
      .then((payload) => {
        if (!active) return;
        setTasks(payload.tasks ?? []);
        const versionTasks = (payload.tasks ?? []).filter((task) => task.versionId === input.versionId);
        if (versionTasks.length) setTaskId(versionTasks[0].id);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load linked tasks.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [input.versionId, tasksEndpoint]);

  async function linkTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTask(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(tasksEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: input.versionId,
          sourceSystem: newTaskSourceSystem.trim() || undefined,
          externalTaskId: newTaskExternalId.trim() || null,
          externalUrl: newTaskExternalUrl.trim() || null,
          title: newTaskTitle,
          description: newTaskDescription,
          frameId: frameId || null,
          sourceNodeId: nodeId || null,
        }),
      });
      const payload = await response.json() as { task?: LinkedTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error || "Could not link the task.");
      const createdTask = {
        ...payload.task,
        agentRunUrl: payload.task.agentRunUrl ?? null,
        pullRequestUrl: payload.task.pullRequestUrl ?? null,
      };
      setTasks((current) => [createdTask, ...current]);
      setTaskId(createdTask.id);
      setNewTaskSourceSystem("");
      setNewTaskExternalId("");
      setNewTaskExternalUrl("");
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNotice("External task linked to this screen and element.");
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Could not link the task.");
    } finally {
      setSavingTask(false);
    }
  }

  async function saveAgentLinks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask) return;
    setSavingAgentLinks(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(tasksEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selectedTask.id,
          agentRunUrl: selectedTaskLinks.agentRunUrl.trim() || null,
          pullRequestUrl: selectedTaskLinks.pullRequestUrl.trim() || null,
        }),
      });
      const payload = await response.json() as { task?: LinkedTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error || "Could not save the agent links.");
      setTasks((current) => current.map((task) => task.id === payload.task!.id ? payload.task! : task));
      setAgentLinkEdits((current) => {
        const next = { ...current };
        delete next[selectedTask.id];
        return next;
      });
      setNotice("Agent and pull request links saved to this handoff task.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the agent links.");
    } finally {
      setSavingAgentLinks(false);
    }
  }

  function toggleScope(scope: AgentScope) {
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  }

  async function copySetupConfiguration(format: "codex" | "generic") {
    setError(null);
    setNotice(null);
    const endpoint = workspaceMcpEndpoint(window.location.origin, input.workspaceId);
    const content = format === "codex"
      ? codexMcpConfiguration(endpoint)
      : genericMcpConfiguration(endpoint);
    const label = format === "codex" ? "Codex config" : "MCP client example";
    setSetupPreview({ label, content });
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`${label} copied. No token was included.`);
    } catch {
      setError(`Could not copy the ${label.toLowerCase()}. Select the preview and copy it manually.`);
    }
  }

  async function copyAgentBrief() {
    setBuildingBrief(true);
    setError(null);
    setNotice(null);
    try {
      const versionUrl = `${input.reviewHref}?versionId=${encodeURIComponent(input.versionId)}`;
      const commentsEndpoint = `${routeBase}/versions/${encodeURIComponent(input.versionId)}/comments`;
      const findingsEndpoint = `${routeBase}/versions/${encodeURIComponent(input.versionId)}/findings`;
      const changelogEndpoint = `${routeBase}/changelog`;
      const compareUrl = baseline
        ? `${routeBase}/compare?from=${encodeURIComponent(baseline.id)}&to=${encodeURIComponent(input.versionId)}`
        : null;
      const unavailable: string[] = [];
      const settled = await Promise.all([
        readJson<CommentsPayload>(commentsEndpoint).catch(() => { unavailable.push("comments"); return null; }),
        readJson<FindingsPayload>(findingsEndpoint).catch(() => { unavailable.push("layout findings"); return null; }),
        readJson<ChangelogPayload>(changelogEndpoint).catch(() => { unavailable.push("approved changelog"); return null; }),
        compareUrl
          ? readJson<ComparePayload>(compareUrl).catch(() => { unavailable.push("version diff"); return null; })
          : Promise.resolve(null),
      ]);
      const [commentPayload, findingPayload, changelogPayload, comparePayload] = settled;

      const changes = comparePayload?.diff.changes.filter((change) => !frameId || change.frameId === frameId) ?? [];
      const frameChanges = comparePayload?.diff.frames.filter((frame) => !frameId || frame.frameId === frameId) ?? [];
      const comments = commentPayload?.comments.filter((comment) => !frameId || comment.frameId === frameId) ?? [];
      const findings = findingPayload?.findings.filter((finding) => !frameId || finding.frameId === frameId) ?? [];
      const approvedChangelogs = changelogPayload?.drafts
        .filter((draft) => draft.status === "approved" && draft.toVersionId === input.versionId)
        .map(({ id, title, summary, statements }) => ({ id, title, summary, statements })) ?? [];
      const nodeLimit = 300;
      const frameNodes = selectedFrame?.nodes ?? [];
      const visibleFrameNodes = frameNodes.slice(0, nodeLimit).map(serializeNode);
      const tokenLimit = 300;
      const visibleTokenBindings = nodeTokenBindings.slice(0, tokenLimit);
      const selectedNodeData = selectedNode ? serializeNode(selectedNode) : null;
      const selectedTaskData = selectedTask ? {
        title: selectedTask.title,
        description: selectedTask.description,
        externalTaskId: selectedTask.externalTaskId,
        externalUrl: selectedTask.externalUrl,
        agentRunUrl: selectedTask.agentRunUrl,
        pullRequestUrl: selectedTask.pullRequestUrl,
      } : null;
      const mcpEndpoint = workspaceMcpEndpoint(window.location.origin, input.workspaceId);
      const requestedScopes = ["handoffs:read", ...scopes];
      const context = {
        project: input.projectId,
        handoff: input.handoffId,
        version: {
          id: input.versionId,
          label: input.versionLabel,
          source: input.source,
          sourceRevisionId: input.sourceRevisionId,
          contentHash: input.contentHash,
          releaseNote: input.releaseNote,
          frozenCanvasUrl: new URL(versionUrl, window.location.origin).toString(),
        },
        task: selectedTaskData,
        acceptanceCriteria: criteria.split("\n").map((line) => line.trim()).filter(Boolean),
        selectedDesignScope: selectedFrame ? {
          frame: {
            id: selectedFrame.id,
            name: selectedFrame.name,
            bounds: {
              x: selectedFrame.sourceX,
              y: selectedFrame.sourceY,
              width: selectedFrame.sourceWidth,
              height: selectedFrame.sourceHeight,
            },
            exact: selectedFrame.exact,
            nodeCount: selectedFrame.nodes.length,
          },
          selectedElement: selectedNodeData,
          exactElementMeasurements: visibleFrameNodes,
          omittedElementMeasurementCount: Math.max(0, frameNodes.length - visibleFrameNodes.length),
          selectedFrameTokenBindings: visibleTokenBindings,
          omittedTokenBindingCount: Math.max(0, nodeTokenBindings.length - visibleTokenBindings.length),
        } : null,
        comparison: baseline ? {
          fromVersionId: baseline.id,
          toVersionId: input.versionId,
          frames: frameChanges,
          changes: changes.slice(0, 300),
          omittedChangeCount: Math.max(0, changes.length - 300),
        } : null,
        comments: comments.slice(0, 200),
        omittedCommentCount: Math.max(0, comments.length - 200),
        layoutFindings: findings.slice(0, 200),
        omittedFindingCount: Math.max(0, findings.length - 200),
        approvedChangelog: approvedChangelogs,
        unavailableSources: unavailable,
        mcp: {
          endpoint: mcpEndpoint,
          transport: "Streamable HTTP",
          authorization: "Bearer ${ASBIR_MCP_TOKEN}",
          requestedScopes,
        },
      };
      const toolInstructions = [
        `1. Call get_snapshot with projectId=${input.projectId}, handoffId=${input.handoffId}, versionId=${input.versionId} to verify the immutable source payload.`,
        baseline ? `2. Call get_version_diff with fromVersionId=${baseline.id} and toVersionId=${input.versionId} to verify the included comparison.` : "2. This handoff has no earlier version to compare.",
        selectedFrame ? `3. Call get_token_bindings with frameId=${selectedFrame.id}; call get_measurements for any sourceNodeId that needs closer inspection.` : "3. Use get_measurements and get_token_bindings for the target frame and elements before changing layout code.",
        `4. Call list_comments and list_findings for versionId=${input.versionId}; preserve unresolved review feedback and rule findings in the implementation plan.`,
        "5. Use the approved changelog only as accepted product intent. Keep measured distances distinct from authored margins and do not infer token bindings.",
      ];
      const generatedBrief = [
        `# Agent handoff: ${input.versionLabel}`,
        "",
        "Use this frozen Asbir Handoff snapshot as the design source of truth. The snapshot remains immutable while code changes are made in the connected repository.",
        "",
        "## MCP tools to retrieve and verify source evidence",
        ...toolInstructions,
        "",
        "## Published snapshot and review context",
        "```json",
        JSON.stringify(context, null, 2),
        "```",
        "",
        "## Repository work",
        "Make code changes only through the connected repository tools and permissions. Do not modify or replace the frozen Handoff version. Link implementation work to the selected task when one is provided.",
      ].join("\n");
      setBrief(generatedBrief);
      await navigator.clipboard.writeText(generatedBrief);
      setNotice("Agent brief copied with the selected version’s source evidence.");
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Could not build the agent brief.");
    } finally {
      setBuildingBrief(false);
    }
  }

  return (
    <section className="min-h-0 overflow-y-auto border-l border-[#3a3a3a] bg-[#202020] p-4 max-lg:border-l-0 max-lg:border-t" aria-labelledby="agent-handoff-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9a9a9a]">Connected tools</p>
          <h2 id="agent-handoff-title" className="mt-1 text-[15px] font-semibold text-[#ededed]">Start with agent</h2>
        </div>
        <span className="rounded-[5px] bg-[#303030] px-2 py-1 font-mono text-[10px] text-[#bdbdbd]">Version {input.versionLabel}</span>
      </div>

      <p className="mt-2 text-[12px] leading-5 text-[#a3a3a3]">Prepare a version-pinned brief with design evidence, review notes, and a linked task for a coding or QA agent.</p>

      <label className="mt-4 block text-[11px] font-medium text-[#bdbdbd]" htmlFor="agent-screen-select">Screen scope</label>
      <select id="agent-screen-select" value={frameId} onChange={(event) => { setFrameId(event.target.value); setNodeId(""); }} className="mt-1.5 min-h-9 w-full rounded-[5px] border border-[#444] bg-[#282828] px-2.5 text-[12px] text-[#e4e4e4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">
        {screenOptions.map((frame) => <option key={frame.id} value={frame.id}>{frame.name}</option>)}
      </select>
      {selectedFrame?.nodes.length ? (
        <>
          <label className="mt-3 block text-[11px] font-medium text-[#bdbdbd]" htmlFor="agent-element-select">Focus element <span className="font-normal text-[#888]">(optional)</span></label>
          <select id="agent-element-select" value={nodeId} onChange={(event) => setNodeId(event.target.value)} className="mt-1.5 min-h-9 w-full rounded-[5px] border border-[#444] bg-[#282828] px-2.5 text-[12px] text-[#e4e4e4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">
            <option value="">Whole screen</option>
            {selectedFrame.nodes.map((node) => <option key={node.sourceNodeId} value={node.sourceNodeId}>{node.name || node.type} · {node.sourceNodeId}</option>)}
          </select>
        </>
      ) : (
        <p className="mt-2 rounded-[5px] bg-[#282828] px-2.5 py-2 text-[11px] leading-5 text-[#999]">This visual-only screen has no captured node measurements or token bindings.</p>
      )}

      <label className="mt-3 block text-[11px] font-medium text-[#bdbdbd]" htmlFor="agent-task-select">Related task</label>
      <select id="agent-task-select" value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={loading} className="mt-1.5 min-h-9 w-full rounded-[5px] border border-[#444] bg-[#282828] px-2.5 text-[12px] text-[#e4e4e4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa] disabled:opacity-60">
        <option value="">No task selected</option>
        {matchingTasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {task.sourceSystem}</option>)}
      </select>
      {selectedTask ? (
        <form className="mt-3 space-y-2 rounded-[5px] border border-[#3d3d3d] bg-[#252525] p-3" onSubmit={saveAgentLinks}>
          <p className="text-[10px] leading-4 text-[#999]">Return the agent run or pull request here to keep implementation progress with this task.</p>
          {selectedTask.agentRunUrl || selectedTask.pullRequestUrl ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
              {selectedTask.agentRunUrl ? <a href={selectedTask.agentRunUrl} target="_blank" rel="noreferrer" className="text-[#d0d0d0] underline underline-offset-2 hover:text-white">Open agent run</a> : null}
              {selectedTask.pullRequestUrl ? <a href={selectedTask.pullRequestUrl} target="_blank" rel="noreferrer" className="text-[#d0d0d0] underline underline-offset-2 hover:text-white">Open pull request</a> : null}
            </div>
          ) : null}
          <label className="block text-[10px] text-[#aaa]">Agent run URL
            <input type="url" maxLength={2000} value={selectedTaskLinks.agentRunUrl} onChange={(event) => setAgentLinkEdits((current) => ({ ...current, [selectedTask.id]: { ...selectedTaskLinks, agentRunUrl: event.target.value } }))} placeholder="https://…" className="mt-1 w-full rounded-[5px] border border-[#444] bg-[#202020] px-2 py-2 text-[11px] text-[#e4e4e4] placeholder:text-[#a0a0a0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />
          </label>
          <label className="block text-[10px] text-[#aaa]">Pull request URL
            <input type="url" maxLength={2000} value={selectedTaskLinks.pullRequestUrl} onChange={(event) => setAgentLinkEdits((current) => ({ ...current, [selectedTask.id]: { ...selectedTaskLinks, pullRequestUrl: event.target.value } }))} placeholder="https://…" className="mt-1 w-full rounded-[5px] border border-[#444] bg-[#202020] px-2 py-2 text-[11px] text-[#e4e4e4] placeholder:text-[#a0a0a0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />
          </label>
          <button type="submit" disabled={savingAgentLinks} className="min-h-8 rounded-[5px] border border-[#494949] px-3 text-[11px] font-medium text-[#dedede] hover:bg-[#303030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa] disabled:opacity-50">{savingAgentLinks ? "Saving…" : "Save returned links"}</button>
        </form>
      ) : null}
      {loading ? <p className="mt-1 text-[10px] text-[#888]" role="status">Loading linked tasks…</p> : null}
      {!loading && matchingTasks.length === 0 ? (
        <p className="mt-2 text-[11px] leading-5 text-[#999]">Your AI can create work through its own ClickUp, Linear, or repository MCP. Link the result here, or use Asbir’s <code>link_task</code> tool.</p>
      ) : null}

      <details className="mt-3 rounded-[5px] border border-[#3d3d3d] bg-[#252525]">
          <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-medium text-[#c9c9c9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Link a task created elsewhere</summary>
          <form className="space-y-2.5 border-t border-[#3b3b3b] p-3" onSubmit={linkTask}>
            <label className="block text-[10px] text-[#aaa]">Task system <span className="font-normal text-[#888]">(optional)</span>
              <input maxLength={80} value={newTaskSourceSystem} onChange={(event) => setNewTaskSourceSystem(event.target.value)} placeholder="ClickUp, Linear, GitHub…" className="mt-1 w-full rounded-[5px] border border-[#444] bg-[#202020] px-2 py-2 text-[11px] text-[#e4e4e4] placeholder:text-[#a0a0a0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />
            </label>
            <label className="block text-[10px] text-[#aaa]">Task ID <span className="font-normal text-[#888]">(optional)</span>
              <input maxLength={500} value={newTaskExternalId} onChange={(event) => setNewTaskExternalId(event.target.value)} className="mt-1 w-full rounded-[5px] border border-[#444] bg-[#202020] px-2 py-2 text-[11px] text-[#e4e4e4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />
            </label>
            <label className="block text-[10px] text-[#aaa]">Task URL <span className="font-normal text-[#888]">(optional)</span>
              <input type="url" maxLength={2000} value={newTaskExternalUrl} onChange={(event) => setNewTaskExternalUrl(event.target.value)} placeholder="https://…" className="mt-1 w-full rounded-[5px] border border-[#444] bg-[#202020] px-2 py-2 text-[11px] text-[#e4e4e4] placeholder:text-[#a0a0a0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />
            </label>
            <label className="block text-[10px] text-[#aaa]">Task title
              <input required maxLength={200} value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} className="mt-1 w-full rounded-[5px] border border-[#444] bg-[#202020] px-2 py-2 text-[11px] text-[#e4e4e4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />
            </label>
            <label className="block text-[10px] text-[#aaa]">Notes <span className="font-normal text-[#888]">(optional)</span>
              <textarea maxLength={6000} value={newTaskDescription} onChange={(event) => setNewTaskDescription(event.target.value)} className="mt-1 min-h-20 w-full resize-y rounded-[5px] border border-[#444] bg-[#202020] px-2 py-2 text-[11px] leading-4 text-[#e4e4e4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />
            </label>
            <button type="submit" disabled={savingTask || loading} className="min-h-8 rounded-[5px] bg-[#e5e5e5] px-3 text-[11px] font-semibold text-[#202020] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa] disabled:opacity-50">{savingTask ? "Linking…" : "Link task"}</button>
          </form>
      </details>

      <label className="mt-4 block text-[11px] font-medium text-[#bdbdbd]" htmlFor="agent-acceptance-criteria">Acceptance criteria</label>
      <textarea id="agent-acceptance-criteria" value={criteria} onChange={(event) => setCriteria(event.target.value)} maxLength={4000} placeholder="What should the implementation or QA pass prove?" className="mt-1.5 min-h-24 w-full resize-y rounded-[5px] border border-[#444] bg-[#282828] px-2.5 py-2 text-[12px] leading-5 text-[#e4e4e4] placeholder:text-[#a0a0a0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]" />

      <fieldset className="mt-4 space-y-2">
        <legend className="text-[11px] font-medium text-[#bdbdbd]">Agent MCP access</legend>
        <p className="text-[10px] leading-4 text-[#888]"><code className="text-[#c9c9c9]">handoffs:read</code> is required for the frozen snapshot.</p>
        {([
          ["tasks:write", "Link external tasks to handoff evidence"],
          ["comments:write", "Leave review comments"],
          ["changelog:write", "Draft changelogs"],
        ] as Array<[AgentScope, string]>).map(([scope, label]) => (
          <label key={scope} className="flex items-center gap-2 text-[10px] text-[#aaa]">
            <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} className="size-3.5 accent-[#c8c8c8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa]" />
            <span>{label} <code className="text-[#c9c9c9]">{scope}</code></span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4 grid gap-2">
        <button type="button" onClick={() => void copyAgentBrief()} disabled={buildingBrief || loading} className="min-h-9 rounded-[5px] bg-[#e5e5e5] px-3 text-[11px] font-semibold text-[#202020] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa] disabled:opacity-50">{buildingBrief ? "Preparing brief…" : "Copy agent brief"}</button>
      </div>
      <details className="mt-2 rounded-[5px] border border-[#3d3d3d] bg-[#252525]">
        <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-medium text-[#c9c9c9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Connect an MCP client</summary>
        <div className="space-y-2.5 border-t border-[#3b3b3b] p-3">
          <p className="text-[10px] leading-4 text-[#999]">{input.integrationHref ? <>Create your personal scoped token in <Link className="underline underline-offset-2 hover:text-white" href={input.integrationHref}>MCP access</Link>.</> : "Open MCP access settings to create a personal scoped token."} The workspace URL is pinned to this team.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copySetupConfiguration("codex")} className="min-h-8 rounded-[5px] bg-[#dedede] px-2 text-[10px] font-semibold text-[#202020] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa]">Copy Codex config</button>
            <button type="button" onClick={() => void copySetupConfiguration("generic")} className="min-h-8 rounded-[5px] border border-[#494949] px-2 text-[10px] font-medium text-[#d0d0d0] hover:bg-[#303030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#aaa]">Copy generic JSON</button>
          </div>
          <p className="text-[10px] leading-4 text-[#888]">Set <code className="text-[#c9c9c9]">ASBIR_MCP_TOKEN</code> in the agent environment. Keep the token in a secret store; it is never included in copied configuration.</p>
          {setupPreview ? (
            <div>
              <p className="mb-1 text-[10px] font-medium text-[#aaa]">{setupPreview.label}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[5px] border border-[#383838] bg-[#1d1d1d] p-2 font-mono text-[10px] leading-4 text-[#c8c8c8]">{setupPreview.content}</pre>
            </div>
          ) : null}
        </div>
      </details>

      {selectedFrame?.exact && selectedFrame.nodes.length ? <p className="mt-2 text-[10px] text-[#999]">Brief includes exact source layout values for {Math.min(selectedFrame.nodes.length, 300)} elements and {Math.min(nodeTokenBindings.length, 300)} token bindings in {selectedFrame.name}.</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-[5px] border border-[#8a6a38] bg-[#3c3020] px-2.5 py-2 text-[11px] leading-4 text-[#f0c77d]">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-[11px] leading-4 text-[#c3c3c3]">{notice}</p> : null}
      {brief ? (
        <details className="mt-4 rounded-[5px] border border-[#3d3d3d] bg-[#252525]">
          <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-medium text-[#c9c9c9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Preview copied brief</summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-[#3b3b3b] p-3 font-mono text-[10px] leading-4 text-[#bcbcbc]">{brief}</pre>
        </details>
      ) : null}
    </section>
  );
}
