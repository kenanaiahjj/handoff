"use client";

import { useObject } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { generatedChangelogSchema } from "@/src/server/ai/schema";
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
  /** IDs for the prompt people paste into their own AI client, which drafts over MCP. */
  mcp: { projectId: string; handoffId: string; handoffName: string; integrationsHref: string | null };
};

function mcpDraftPrompt(input: { projectId: string; handoffId: string; handoffName: string; from?: { id: string; versionLabel: string }; to?: { id: string; versionLabel: string } }) {
  const ids = `projectId "${input.projectId}", handoffId "${input.handoffId}"${input.from ? `, fromVersionId "${input.from.id}"` : ""}${input.to ? `, toVersionId "${input.to.id}"` : ""}`;
  return [
    `Use the Asbir Handoff MCP tools to draft a changelog for "${input.handoffName}"${input.from && input.to ? ` (version ${input.from.versionLabel} → ${input.to.versionLabel})` : ""}.`,
    `1. Call list_changed_screens with ${ids} to see which screens changed.`,
    `2. Call get_changelog_evidence with the same IDs and read every page of evidence.`,
    `3. Write short statements for product, developers, and QA. Cite evidence IDs for every statement and don't claim anything the evidence doesn't show.`,
    `4. Save it with save_changelog_draft so the team can review and approve it in Handoff.`,
  ].join("\n");
}

/** The stream route answers failures with a JSON `{ error }` body; useObject surfaces it as the message. */
function generationErrorMessage(cause: Error) {
  try {
    const payload = JSON.parse(cause.message) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error) return payload.error;
  } catch {
    // Not JSON: the stream itself failed after it started.
  }
  return "The AI draft could not be completed. Try again.";
}

const audienceLabels: Record<Audience, string> = {
  product: "Product",
  developer: "Developer",
  qa: "QA",
};

export function ChangelogPanel({ endpoint, versions, selectedVersionId, versionHrefPrefix, mcp }: ChangelogPanelProps) {
  const [promptCopied, setPromptCopied] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedVersionIndex = versions.findIndex((version) => version.id === selectedVersionId);
  const precedingVersionId = versions[selectedVersionIndex + 1]?.id
    ?? versions.find((version) => version.id !== selectedVersionId)?.id
    ?? "";
  const [versionPair, setVersionPair] = useState<{
    selectedVersionId: string;
    fromVersionId: string;
    toVersionId: string;
  } | null>(null);
  const currentVersionPair = versionPair?.selectedVersionId === selectedVersionId ? versionPair : null;
  const fromVersionId = currentVersionPair?.fromVersionId ?? precedingVersionId;
  const toVersionId = currentVersionPair?.toVersionId ?? selectedVersionId;
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

  // AI SDK UI: stream the draft object so statements appear as the model writes them.
  // The server validates citations and saves the draft before it closes the stream.
  const generation = useObject({
    api: `${endpoint}/stream`,
    schema: generatedChangelogSchema,
    onFinish: ({ error: validationError }) => {
      if (validationError) {
        setError("The AI draft did not match the expected format. Try again.");
        return;
      }
      setNotice("AI draft created. Review each statement and its supporting evidence.");
      void loadDrafts();
    },
    onError: (cause) => setError(generationErrorMessage(cause)),
  });
  const generating = generation.isLoading;
  const streamed = generation.object;

  async function copyPrompt() {
    const prompt = mcpDraftPrompt({
      ...mcp,
      from: versions.find((version) => version.id === fromVersionId),
      to: versions.find((version) => version.id === toVersionId),
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1800);
    } catch {
      setError("Couldn’t copy the prompt. Select it from the preview instead.");
    }
  }

  function generateDraft() {
    setError(null);
    setNotice(null);
    generation.submit({ fromVersionId, toVersionId });
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
    <section className="rounded-panel border border-border bg-surface p-3" aria-labelledby="changelog-title">
      <div className="flex flex-col justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-foreground-subtle">Drafted by your AI · evidence linked</p>
          <h2 className="mt-1 text-base font-semibold text-foreground" id="changelog-title">Changelog</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-foreground-muted">
            Your own AI client drafts the changelog through MCP, so Handoff doesn’t need an AI key. Paste the prompt into your AI; its draft appears here for the team to review and approve.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="dial-button min-h-8 px-2.5 text-xs" disabled={loading} onClick={() => void refreshDrafts()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <span className="rounded-control bg-surface-inset px-2.5 py-1 text-[12px] font-medium text-foreground-subtle">
            {drafts.length.toString().padStart(2, "0")} drafts
          </span>
        </div>
      </div>

      {versions.length >= 2 ? (
        <div className="mt-4 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-foreground-muted">
              Before
              <select className="mt-1.5 block min-h-9 w-full rounded-control px-3 text-[13px] text-foreground" value={fromVersionId} onChange={(event) => setVersionPair({ selectedVersionId, fromVersionId: event.target.value, toVersionId })}>
                {versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-foreground-muted">
              After
              <select className="mt-1.5 block min-h-9 w-full rounded-control px-3 text-[13px] text-foreground" value={toVersionId} onChange={(event) => setVersionPair({ selectedVersionId, fromVersionId, toVersionId: event.target.value })}>
                {versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel}</option>)}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="capture-primary-action min-h-9 px-4 text-[13px]"
            onClick={() => void copyPrompt()}
            disabled={!fromVersionId || !toVersionId || fromVersionId === toVersionId}
          >
            {promptCopied ? "Prompt copied" : "Copy prompt for your AI"}
          </button>
          <details className="rounded-control bg-surface-inset px-3 py-2 text-xs text-foreground-muted">
            <summary className="cursor-pointer font-medium">Preview prompt</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground-muted">{mcpDraftPrompt({
              ...mcp,
              from: versions.find((version) => version.id === fromVersionId),
              to: versions.find((version) => version.id === toVersionId),
            })}</pre>
          </details>
          <p className="text-[11px] leading-4 text-foreground-subtle">
            Your AI needs an MCP token with <code className="font-mono text-foreground-muted">handoffs:read</code> and <code className="font-mono text-foreground-muted">changelog:write</code>.
            {mcp.integrationsHref ? <> <a className="text-foreground-muted underline underline-offset-2 hover:text-foreground" href={mcp.integrationsHref}>Set up MCP</a></> : null}
          </p>
          {configured ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2">
              <button
                type="button"
                className="dial-button min-h-8 px-3 text-xs"
                onClick={generateDraft}
                disabled={loading || generating || fromVersionId === toVersionId}
              >
                {generating ? "Writing draft…" : "Or generate here"}
              </button>
              {generating ? <button type="button" className="dial-button min-h-8 px-3 text-xs" onClick={generation.stop}>Stop</button> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 rounded-control bg-surface-inset px-3 py-3 text-xs leading-5 text-foreground-muted">Add a second snapshot version to draft a changelog.</p>
      )}

      {loading ? <p className="mt-3 text-xs text-foreground-subtle" role="status">Loading changelogs…</p> : null}
      {error ? <p className="mt-3 rounded-control border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-5 text-warning" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-success" role="status">{notice}</p> : null}

      {generating ? (
        <article aria-busy="true" aria-live="polite" className="mt-4 rounded-surface border border-border bg-background p-3">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-foreground-subtle">
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-accent" />
            Writing draft
          </p>
          <h3 className="mt-2 text-sm font-semibold text-foreground">{streamed?.title || "…"}</h3>
          {streamed?.summary ? <p className="mt-1.5 whitespace-pre-line text-xs leading-5 text-foreground-muted">{streamed.summary}</p> : null}
          {streamed?.statements?.length ? (
            <ul className="mt-3 space-y-2">
              {streamed.statements.map((statement, index) => statement?.text ? (
                <li className="rounded-control bg-surface-raised px-3 py-2 text-xs leading-5 text-foreground" key={index}>
                  {statement.audience ? <span className="mr-1.5 font-medium text-foreground-subtle">{audienceLabels[statement.audience]}</span> : null}
                  {statement.text}
                </li>
              ) : null)}
            </ul>
          ) : null}
        </article>
      ) : null}

      <div className="mt-4 space-y-3">
        {drafts.map((draft) => (
          <article className="rounded-control border border-border bg-background p-3" key={draft.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-pill px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${draft.status === "approved" ? "bg-success/15 text-success" : "bg-surface-raised text-foreground-subtle"}`}>
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
                    <label className="text-[12px] font-semibold text-foreground-subtle">
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
        {!loading && drafts.length === 0 ? <p className="rounded-control bg-surface-raised px-3 py-3 text-xs leading-5 text-foreground-subtle">No changelog drafts yet.</p> : null}
      </div>
    </section>
  );
}
