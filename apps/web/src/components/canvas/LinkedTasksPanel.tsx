"use client";

import { useEffect, useState } from "react";

type VersionOption = { id: string; versionLabel: string };
type LinkedTask = {
  id: string;
  versionId: string;
  sourceSystem: string;
  externalTaskId: string | null;
  externalUrl: string | null;
  agentRunUrl: string | null;
  pullRequestUrl: string | null;
  title: string;
  description: string;
  createdAt: string;
};

export function LinkedTasksPanel({ input }: {
  input: {
    workspaceId: string;
    projectId: string;
    handoffId: string;
    selectedVersionId: string;
    versions: VersionOption[];
  };
}) {
  const endpoint = `/api/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/handoffs/${encodeURIComponent(input.handoffId)}/tasks`;
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [versionId, setVersionId] = useState(input.selectedVersionId);
  const [sourceSystem, setSourceSystem] = useState("");
  const [externalTaskId, setExternalTaskId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load linked tasks.");
        if (active) setTasks(payload.tasks ?? []);
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load linked tasks."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);

  async function linkTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId,
          sourceSystem: sourceSystem.trim() || undefined,
          externalTaskId: externalTaskId.trim() || null,
          externalUrl: externalUrl.trim() || null,
          title,
          description,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.task) throw new Error(payload.error || "Could not link this external task.");
      setTasks((current) => [payload.task, ...current]);
      setSourceSystem("");
      setExternalTaskId("");
      setExternalUrl("");
      setTitle("");
      setDescription("");
      setNotice("External task linked to this frozen version.");
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Could not link this external task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 rounded-panel border border-border bg-surface p-4 sm:p-5" aria-labelledby="linked-tasks-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Connected tools</p>
          <h2 id="linked-tasks-title" className="mt-1 text-base font-semibold text-foreground">Tasks</h2>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">Link work created by your AI in ClickUp, Linear, or another connected tool.</p>
        </div>
        <span className="rounded-pill bg-surface-raised px-2.5 py-1 font-mono text-[10px] text-foreground-subtle">{tasks.length.toString().padStart(2, "0")} linked</span>
      </div>

      <details className="mt-4 rounded-control border border-border bg-surface-raised">
        <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Link an existing task</summary>
        <form className="grid gap-3 border-t border-border p-3 sm:grid-cols-2" onSubmit={linkTask}>
          <label className="block text-xs font-medium text-foreground-muted">Snapshot version
            <select value={versionId} onChange={(event) => setVersionId(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {input.versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-foreground-muted">Task system <span className="font-normal text-foreground-subtle">(optional)</span>
            <input maxLength={80} value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="ClickUp, Linear, GitHub…" className="mt-1.5 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground placeholder:text-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>
          <label className="block text-xs font-medium text-foreground-muted">External task ID <span className="font-normal text-foreground-subtle">(optional)</span>
            <input maxLength={500} value={externalTaskId} onChange={(event) => setExternalTaskId(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>
          <label className="block text-xs font-medium text-foreground-muted">External task URL <span className="font-normal text-foreground-subtle">(optional)</span>
            <input type="url" maxLength={2000} value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://…" className="mt-1.5 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground placeholder:text-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>
          <label className="block text-xs font-medium text-foreground-muted sm:col-span-2">Task title
            <input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>
          <label className="block text-xs font-medium text-foreground-muted sm:col-span-2">Notes <span className="font-normal text-foreground-subtle">(optional)</span>
            <textarea maxLength={6000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 min-h-20 w-full resize-y rounded-control border border-border bg-surface px-3 py-2.5 text-sm leading-5 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>
          <div className="sm:col-span-2"><button type="submit" disabled={saving || loading} className="min-h-10 rounded-control bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Linking…" : "Link task"}</button></div>
        </form>
      </details>

      {error ? <p role="alert" className="mt-3 rounded-control border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-5 text-warning">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-xs text-primary">{notice}</p> : null}
      {loading ? <p role="status" className="mt-3 text-xs text-foreground-subtle">Loading tasks…</p> : null}
      {tasks.length ? (
        <ul className="mt-4 space-y-2">
          {tasks.map((task) => <li key={task.id} className="rounded-control border border-border bg-background px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{task.title}</span>
              {task.externalUrl ? <a href={task.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-4">Open in {task.sourceSystem}</a> : <span className="text-xs text-foreground-subtle">{task.sourceSystem}{task.externalTaskId ? ` · ${task.externalTaskId}` : ""}</span>}
            </div>
            <p className="mt-1 text-xs text-foreground-subtle">Version {input.versions.find((version) => version.id === task.versionId)?.versionLabel ?? "snapshot"} · {new Date(task.createdAt).toLocaleString()}</p>
            {task.description ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground-muted">{task.description}</p> : null}
            {task.agentRunUrl || task.pullRequestUrl ? <div className="mt-2 flex gap-3 text-xs">{task.agentRunUrl ? <a href={task.agentRunUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">Agent run</a> : null}{task.pullRequestUrl ? <a href={task.pullRequestUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">Pull request</a> : null}</div> : null}
          </li>)}
        </ul>
      ) : !loading ? <p className="mt-3 text-xs text-foreground-subtle">No external tasks linked to this handoff yet.</p> : null}
    </section>
  );
}
