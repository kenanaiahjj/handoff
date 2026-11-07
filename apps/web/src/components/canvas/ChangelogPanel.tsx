"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { evidenceCanvasHref } from "./evidence-link";

type Audience = "product" | "developer" | "qa";
type Evidence = {
  id: string;
  kind: "frame" | "diff" | "finding" | "comment";
  label: string;
  details: string;
  versionId: string;
  frameId: string;
  sourceNodeId: string | null;
  path: string | null;
};
type Statement = { audience: Audience; text: string; evidence: string[] };
type Draft = {
  id: string;
  handoffId: string;
  fromVersionId: string;
  toVersionId: string;
  title: string;
  summary: string;
  statements: Statement[];
  evidence: Evidence[];
  model: string;
  status: "draft" | "approved";
  createdAt: string;
  updatedAt: string;
};

type ChangelogPanelProps = {
  endpoint: string;
  versions: Array<{ id: string; versionLabel: string }>;
  selectedVersionId: string;
  versionHrefPrefix: string;
};

const audienceLabels: Record<Audience, string> = {
  product: "Product",
  developer: "Developer",
  qa: "QA",
};

export function ChangelogPanel({ endpoint, versions, selectedVersionId, versionHrefPrefix }: ChangelogPanelProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const newestOtherVersion = versions.find((version) => version.id !== selectedVersionId)?.id ?? "";
  const [fromVersionId, setFromVersionId] = useState(newestOtherVersion);
  const [toVersionId, setToVersionId] = useState(selectedVersionId);
  const evidenceById = useMemo(
    () => new Map(drafts.flatMap((draft) => draft.evidence.map((item) => [item.id, item] as const))),
    [drafts],
  );

  const loadDrafts = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load changelog drafts.");
      if (signal?.aborted) return;
      setError(null);
      setConfigured(Boolean(payload.configured));
      setDrafts(Array.isArray(payload.drafts) ? payload.drafts : []);
    } catch (loadError: unknown) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load changelog drafts.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint]);

  const refreshDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    await loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load changelog drafts.");
        if (!active) return;
        setError(null);
        setConfigured(Boolean(payload.configured));
        setDrafts(Array.isArray(payload.drafts) ? payload.drafts : []);
      })
      .catch((loadError: unknown) => {
        if (active && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "Could not load changelog drafts.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void refreshDrafts();
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refreshDrafts]);

  async function generateDraft() {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromVersionId, toVersionId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not generate a changelog draft.");
      setDrafts((current) => [payload.draft as Draft, ...current]);
      setNotice("AI draft created. Review each statement and its supporting evidence.");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Could not generate a changelog draft.");
    } finally {
      setGenerating(false);
    }
  }

  function updateDraft(id: string, update: (draft: Draft) => Draft) {
    setDrafts((current) => current.map((draft) => draft.id === id ? update(draft) : draft));
  }

  async function saveDraft(draft: Draft, status: Draft["status"] = draft.status) {
    setSavingId(draft.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          summary: draft.summary,
          statements: draft.statements,
          status,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save this changelog draft.");
      setDrafts((current) => current.map((item) => item.id === draft.id ? payload.draft as Draft : item));
      setNotice(status === "approved" ? "Changelog approved." : "Changelog saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this changelog draft.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="mt-4 rounded-panel border border-border bg-surface p-4 sm:p-5" aria-labelledby="changelog-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">AI-assisted · evidence linked</p>
          <h2 className="mt-1 text-base font-semibold text-foreground" id="changelog-title">Changelog</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-foreground-muted">
            Drafts cite screen changes, layout findings, and team comments. Generate one here or save a draft from your connected AI through MCP; review every statement before approval.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="min-h-8 rounded-control px-2.5 text-xs font-medium text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" disabled={loading} onClick={() => void refreshDrafts()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <span className="rounded-pill bg-surface-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-foreground-subtle">
            {drafts.length.toString().padStart(2, "0")} drafts
          </span>
        </div>
      </div>

      {versions.length >= 2 ? (
        <div className="mt-4 grid gap-3 rounded-control bg-surface-raised p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="block text-xs font-medium text-foreground-muted">
            Before
            <select className="mt-1.5 block min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" value={fromVersionId} onChange={(event) => setFromVersionId(event.target.value)}>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-foreground-muted">
            After
            <select className="mt-1.5 block min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" value={toVersionId} onChange={(event) => setToVersionId(event.target.value)}>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="min-h-10 rounded-control bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void generateDraft()}
            disabled={!configured || loading || generating || versions.length < 2 || !fromVersionId || !toVersionId || fromVersionId === toVersionId}
          >
            {generating ? "Generating…" : "Generate draft"}
          </button>
        </div>
      ) : (
        <p className="mt-4 rounded-control bg-surface-raised px-3 py-3 text-xs leading-5 text-foreground-muted">Add a second snapshot version to generate a changelog.</p>
      )}

      {configured === false ? (
        <p className="mt-3 rounded-control border border-border bg-surface-raised px-3 py-3 text-xs leading-5 text-foreground-muted">
          One-click drafting uses <code className="font-mono text-foreground">OPENAI_API_KEY</code> on the server. You can draft with your connected AI instead: give its MCP token <code className="font-mono text-foreground">handoffs:read</code> and <code className="font-mono text-foreground">changelog:write</code>, then have it call <code className="font-mono text-foreground">get_changelog_evidence</code> and <code className="font-mono text-foreground">save_changelog_draft</code>. Return here and select Refresh to review the saved draft.
        </p>
      ) : null}
      {loading ? <p className="mt-3 text-xs text-foreground-subtle" role="status">Loading changelogs…</p> : null}
      {error ? <p className="mt-3 rounded-control border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-5 text-warning" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-primary" role="status">{notice}</p> : null}

      <div className="mt-4 space-y-3">
        {drafts.map((draft) => (
          <article className="rounded-control border border-border bg-background p-4" key={draft.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-pill px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${draft.status === "approved" ? "bg-primary/15 text-primary" : "bg-surface-raised text-foreground-subtle"}`}>
                  {draft.status}
                </span>
                <span className="text-[10px] text-foreground-subtle">{versions.find((version) => version.id === draft.fromVersionId)?.versionLabel ?? "Before"} → {versions.find((version) => version.id === draft.toVersionId)?.versionLabel ?? "After"}</span>
              </div>
              <span className="text-[10px] text-foreground-subtle">Model: {draft.model}</span>
            </div>

            <label className="mt-3 block text-xs font-medium text-foreground-muted">
              Title
              <input className="mt-1.5 min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" maxLength={160} value={draft.title} onChange={(event) => updateDraft(draft.id, (item) => ({ ...item, title: event.target.value }))} />
            </label>
            <label className="mt-3 block text-xs font-medium text-foreground-muted">
              Summary
              <textarea className="mt-1.5 min-h-20 w-full resize-y rounded-control border border-border bg-surface px-3 py-2.5 text-sm leading-5 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" maxLength={2000} value={draft.summary} onChange={(event) => updateDraft(draft.id, (item) => ({ ...item, summary: event.target.value }))} />
            </label>

            <div className="mt-4 space-y-3">
              {draft.statements.map((statement, index) => (
                <div className="rounded-control bg-surface-raised p-3" key={`${draft.id}-${index}`}>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
                      Audience
                      <select className="ml-2 min-h-8 rounded-control border border-border bg-surface px-2 text-xs font-medium normal-case tracking-normal text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" value={statement.audience} onChange={(event) => updateDraft(draft.id, (item) => ({ ...item, statements: item.statements.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, audience: event.target.value as Audience } : candidate) }))}>
                        {Object.entries(audienceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <button type="button" className="min-h-8 rounded-control px-2 text-[10px] text-foreground-subtle hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40" aria-label={`Remove ${audienceLabels[statement.audience]} statement`} disabled={draft.statements.length <= 1} onClick={() => updateDraft(draft.id, (item) => ({ ...item, statements: item.statements.filter((_, candidateIndex) => candidateIndex !== index) }))}>Remove</button>
                  </div>
                  <textarea aria-label={`${audienceLabels[statement.audience]} changelog statement`} className="mt-2 min-h-16 w-full resize-y rounded-control border border-border bg-surface px-3 py-2.5 text-sm leading-5 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" maxLength={2000} value={statement.text} onChange={(event) => updateDraft(draft.id, (item) => ({ ...item, statements: item.statements.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, text: event.target.value } : candidate) }))} />
                  <div className="mt-2 space-y-1.5">
                    {statement.evidence.map((evidenceId) => {
                      const evidence = evidenceById.get(evidenceId) ?? draft.evidence.find((item) => item.id === evidenceId);
                      return evidence ? (
                        <details className="rounded-control border border-border/70 bg-surface px-2.5 py-2 text-xs" key={evidence.id}>
                          <summary className="cursor-pointer font-medium text-foreground-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Evidence · {evidence.label}</summary>
                          <p className="mt-2 leading-5 text-foreground-subtle">{evidence.details}</p>
                          <p className="mt-1 break-all font-mono text-[10px] text-foreground-subtle">{[evidence.path, evidence.sourceNodeId].filter(Boolean).join(" · ") || evidence.kind}</p>
                            <a aria-label={`Open ${evidence.label} ${evidence.sourceNodeId ? "element" : "screen"} in the canvas`} className="mt-2 inline-flex min-h-8 items-center rounded-control px-2 text-xs font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={evidenceCanvasHref(versionHrefPrefix, evidence)}>
                              Open {evidence.sourceNodeId ? "element" : "screen"} in canvas
                            </a>
                        </details>
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {draft.status === "approved" ? (
                <button type="button" className="min-h-10 rounded-control border border-border px-3 text-xs font-medium text-foreground-muted hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" disabled={savingId === draft.id} onClick={() => void saveDraft(draft, "draft")}>{savingId === draft.id ? "Saving…" : "Reopen draft"}</button>
              ) : (
                <>
                  <button type="button" className="min-h-10 rounded-control border border-border px-3 text-xs font-medium text-foreground-muted hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" disabled={savingId === draft.id} onClick={() => void saveDraft(draft)}>{savingId === draft.id ? "Saving…" : "Save edits"}</button>
                  <button type="button" className="min-h-10 rounded-control bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" disabled={savingId === draft.id} onClick={() => void saveDraft(draft, "approved")}>{savingId === draft.id ? "Saving…" : "Approve changelog"}</button>
                </>
              )}
            </div>
          </article>
        ))}
        {!loading && drafts.length === 0 && configured !== false ? <p className="rounded-control bg-surface-raised px-3 py-3 text-xs leading-5 text-foreground-subtle">No changelog drafts yet.</p> : null}
      </div>
    </section>
  );
}
