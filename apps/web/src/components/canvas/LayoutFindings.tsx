"use client";

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { LayoutFinding } from "@/src/server/services/layout-rules";

type FindingComment = {
  id: string;
  findingKey: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type Finding = LayoutFinding & {
  status: "open" | "resolved";
  assigneeUserId: string | null;
  note: string | null;
  comments: FindingComment[];
};

type FindingMember = { id: string; name: string };
type FindingPayload = {
  findings: Finding[];
  unsupportedReason: string | null;
  members: FindingMember[];
};

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return `"${text.replaceAll('"', '""')}"`;
}

export function LayoutFindings({ endpoint }: { endpoint: string }) {
  const [data, setData] = useState<FindingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as FindingPayload | { error?: string };
        if (!response.ok || !("findings" in payload)) {
          throw new Error("error" in payload ? payload.error ?? "Could not load layout findings." : "Could not load layout findings.");
        }
        setData(payload);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Could not load layout findings.");
      });
    return () => controller.abort();
  }, [endpoint]);

  const updateFinding = useCallback(async (
    findingKey: string,
    updates: { status?: "open" | "resolved"; assigneeUserId?: string | null; note?: string | null },
  ) => {
    const current = data?.findings.find((finding) => finding.findingKey === findingKey);
    if (!current) return;
    const response = await fetch(`${endpoint}?findingKey=${encodeURIComponent(findingKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: updates.status ?? current.status,
        assigneeUserId: updates.assigneeUserId !== undefined ? updates.assigneeUserId : current.assigneeUserId,
        note: updates.note !== undefined ? updates.note : current.note,
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update this finding.");
    setData((latest) => latest ? {
      ...latest,
      findings: latest.findings.map((finding) => finding.findingKey === findingKey ? { ...finding, ...updates } : finding),
    } : latest);
  }, [data, endpoint]);

  const addFindingComment = useCallback(async (findingKey: string, body: string) => {
    const response = await fetch(`${endpoint}?findingKey=${encodeURIComponent(findingKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const payload = await response.json() as { comment?: FindingComment; error?: string };
    if (!response.ok || !payload.comment) throw new Error(payload.error ?? "Could not add this comment.");
    const comment = payload.comment;
    setData((latest) => latest ? {
      ...latest,
      findings: latest.findings.map((finding) => finding.findingKey === findingKey
        ? { ...finding, comments: [...finding.comments, comment] }
        : finding),
    } : latest);
    return comment;
  }, [endpoint]);

  const openCount = useMemo(() => data?.findings.filter((finding) => finding.status === "open").length ?? 0, [data]);

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["status", "rule", "frame", "element", "path", "actual", "expected", "summary", "assignee", "note", "comment_count", "comments"],
      ...data.findings.map((finding) => [
        finding.status,
        finding.ruleId,
        finding.frameName,
        finding.nodeName ?? finding.sourceNodeId ?? "Frame",
        finding.path,
        finding.actual,
        finding.expected,
        finding.summary,
        data.members.find((member) => member.id === finding.assigneeUserId)?.name ?? "",
        finding.note ?? "",
        finding.comments.length,
        finding.comments.map((comment) => `${comment.authorName} · ${comment.createdAt}\n${comment.body}`).join("\n\n"),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "asbir-handoff-layout-findings.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="layout-findings-title" className="mt-5 rounded-panel border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground-subtle">Deterministic checks</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground" id="layout-findings-title">Layout findings</h2>
          <p className="mt-1 text-xs text-foreground-muted">{data ? `${openCount} open · ${data.findings.length} total` : "Checking captured layout…"}</p>
        </div>
        <button className="min-h-10 rounded-control border border-border bg-surface-inset px-3 text-xs text-foreground-muted hover:text-foreground disabled:opacity-50" disabled={!data?.findings.length} onClick={exportCsv} type="button">Export CSV</button>
      </div>

      {error ? <p aria-live="assertive" className="mt-4 rounded-control border border-warning/30 bg-warning/5 p-3 text-xs text-warning">{error}</p> : null}
      {data?.unsupportedReason ? <p className="mt-4 rounded-control bg-surface-inset p-3 text-xs leading-5 text-foreground-muted">{data.unsupportedReason}</p> : null}
      {data && !data.unsupportedReason && data.findings.length === 0 ? <p className="mt-4 rounded-control bg-surface-inset p-3 text-xs text-foreground-muted">No configured rules were violated by this snapshot.</p> : null}

      {data?.findings.length ? (
        <ul className="mt-4 divide-y divide-border">
          {data.findings.map((finding) => (
            <li className="py-4 first:pt-0" key={finding.findingKey}>
              <FindingCard finding={finding} members={data.members} onComment={addFindingComment} onUpdate={updateFinding} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FindingCard({
  finding,
  members,
  onComment,
  onUpdate,
}: {
  finding: Finding;
  members: FindingMember[];
  onComment: (findingKey: string, body: string) => Promise<FindingComment>;
  onUpdate: (findingKey: string, updates: { status?: "open" | "resolved"; assigneeUserId?: string | null; note?: string | null }) => Promise<void>;
}) {
  const [note, setNote] = useState(finding.note ?? "");
  const [commentDraft, setCommentDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentAdded, setCommentAdded] = useState(false);
  const commentInputId = useId();
  const commentErrorId = useId();

  async function save(updates: { status?: "open" | "resolved"; assigneeUserId?: string | null; note?: string | null }) {
    setSaving(true);
    setError(null);
    try {
      await onUpdate(finding.findingKey, updates);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this finding.");
    } finally {
      setSaving(false);
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!body) return;
    setCommenting(true);
    setCommentError(null);
    setCommentAdded(false);
    try {
      await onComment(finding.findingKey, body);
      setCommentDraft("");
      setCommentAdded(true);
    } catch (cause) {
      setCommentError(cause instanceof Error ? cause.message : "Could not add this comment.");
    } finally {
      setCommenting(false);
    }
  }

  return (
    <article className="grid gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-control bg-warning/10 px-2 py-1 font-mono text-[10px] uppercase text-warning">{finding.category}</span>
          <span className="font-mono text-[10px] text-foreground-subtle">{finding.ruleId}</span>
          <span className={`rounded-control px-2 py-1 text-[10px] ${finding.status === "open" ? "bg-primary/10 text-primary" : "bg-surface-raised text-foreground-muted"}`}>{finding.status}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-foreground">{finding.summary}</p>
        <p className="mt-1 break-all font-mono text-[10px] text-foreground-subtle">{finding.frameName}{finding.nodeName ? ` · ${finding.nodeName}` : ""} · {finding.path}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <p className="rounded-control bg-surface-inset p-2 text-[10px] text-foreground-muted">Actual: {JSON.stringify(finding.actual) ?? "—"}</p>
          <p className="rounded-control bg-surface-inset p-2 text-[10px] text-foreground-muted">Expected: {JSON.stringify(finding.expected)}</p>
        </div>
        <label className="mt-3 block text-[10px] text-foreground-subtle">
          Finding note
          <textarea className="mt-1 min-h-16 w-full resize-y rounded-control border border-border bg-background px-2.5 py-2 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Add an implementation or QA note" value={note} />
        </label>
        {error ? <p aria-live="assertive" className="mt-1 text-[10px] text-warning">{error}</p> : null}
        <button className="mt-2 min-h-8 rounded-control bg-surface-raised px-2.5 text-[10px] text-foreground-muted hover:text-foreground disabled:opacity-50" disabled={saving || note === (finding.note ?? "")} onClick={() => void save({ note: note.trim() || null })} type="button">{saving ? "Saving…" : "Save note"}</button>
        <section aria-label={`Comments for ${finding.ruleId}`} className="mt-4 border-t border-border pt-3">
          <h3 className="text-[10px] font-semibold text-foreground">Comments <span className="font-normal text-foreground-subtle">({finding.comments.length})</span></h3>
          {finding.comments.length ? (
            <ol className="mt-2 space-y-2">
              {finding.comments.map((comment) => (
                <li className="rounded-control bg-surface-inset px-2.5 py-2" key={comment.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[10px]">
                    <span className="font-medium text-foreground">{comment.authorName}</span>
                    <time className="text-foreground-subtle" dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground-muted">{comment.body}</p>
                </li>
              ))}
            </ol>
          ) : <p className="mt-2 text-[10px] text-foreground-subtle">No comments yet.</p>}
          <form className="mt-3" onSubmit={(event) => void submitComment(event)}>
            <label className="block text-[10px] text-foreground-subtle" htmlFor={commentInputId}>Add a comment</label>
            <textarea
              aria-describedby={commentError ? commentErrorId : undefined}
              className="mt-1 min-h-16 w-full resize-y rounded-control border border-border bg-background px-2.5 py-2 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              id={commentInputId}
              maxLength={4000}
              onChange={(event) => {
                setCommentDraft(event.target.value);
                setCommentAdded(false);
              }}
              placeholder="Share a question, decision, or QA note"
              value={commentDraft}
            />
            {commentError ? <p className="mt-1 text-[10px] text-warning" id={commentErrorId} role="alert">{commentError}</p> : null}
            {commentAdded ? <p className="mt-1 text-[10px] text-foreground-muted" role="status">Comment added.</p> : null}
            <button className="mt-2 min-h-8 rounded-control bg-surface-raised px-2.5 text-[10px] text-foreground-muted hover:text-foreground disabled:opacity-50" disabled={commenting || !commentDraft.trim()} type="submit">{commenting ? "Posting…" : "Post comment"}</button>
          </form>
        </section>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[10px] text-foreground-subtle">
          Assigned to
          <select aria-label={`Assign finding ${finding.ruleId}`} className="min-h-10 rounded-control border border-border bg-background px-2 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" disabled={saving} onChange={(event) => void save({ assigneeUserId: event.target.value || null })} value={finding.assigneeUserId ?? ""}>
            <option value="">Unassigned</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <button className="min-h-10 rounded-control border border-border bg-surface-inset px-3 text-xs text-foreground-muted hover:text-foreground disabled:opacity-50" disabled={saving} onClick={() => void save({ status: finding.status === "open" ? "resolved" : "open" })} type="button">{finding.status === "open" ? "Mark resolved" : "Reopen finding"}</button>
      </div>
    </article>
  );
}
