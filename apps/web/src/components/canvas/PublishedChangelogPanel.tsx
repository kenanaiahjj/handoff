"use client";

import { useEffect, useState } from "react";
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
type PublishedDraft = {
  id: string;
  fromVersionId: string;
  toVersionId: string;
  title: string;
  summary: string;
  statements: Array<{ audience: Audience; text: string; evidence: string[] }>;
  evidence: Evidence[];
  createdAt: string;
};

const audienceLabels: Record<Audience, string> = {
  product: "Product",
  developer: "Developer",
  qa: "QA",
};

export function PublishedChangelogPanel({
  endpoint,
  versionId,
  versionLabel,
  versionHrefPrefix,
}: {
  endpoint: string;
  versionId: string;
  versionLabel: string;
  versionHrefPrefix: string;
}) {
  const requestUrl = `${endpoint}?${new URLSearchParams({ versionId }).toString()}`;
  const [result, setResult] = useState<{ requestUrl: string; drafts: PublishedDraft[]; error: string | null } | null>(null);
  const loading = result?.requestUrl !== requestUrl;
  const drafts = result?.requestUrl === requestUrl ? result.drafts : [];
  const error = result?.requestUrl === requestUrl ? result.error : null;

  useEffect(() => {
    const controller = new AbortController();
    fetch(requestUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { drafts?: PublishedDraft[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load the approved changelog.");
        if (!controller.signal.aborted) {
          setResult({ requestUrl, drafts: Array.isArray(payload.drafts) ? payload.drafts : [], error: null });
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setResult({
            requestUrl,
            drafts: [],
            error: cause instanceof Error ? cause.message : "Could not load the approved changelog.",
          });
        }
      });
    return () => controller.abort();
  }, [requestUrl]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#202020] p-3" aria-labelledby="published-changelog-title">
      <header className="border-b border-[#383838] pb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#929292]">Published notes</p>
        <h2 className="mt-1 text-[13px] font-semibold text-[#ededed]" id="published-changelog-title">Changelog</h2>
        <p className="mt-1 text-[11px] leading-5 text-[#999]">Approved notes and their source evidence for Version {versionLabel}.</p>
      </header>

      {loading ? <p className="py-4 text-[12px] text-[#999]" role="status">Loading changelog…</p> : null}
      {error ? <p className="mt-3 rounded-[5px] border border-[#70453f] bg-[#32211f] px-3 py-2.5 text-[11px] leading-5 text-[#f0aaa0]" role="alert">{error}</p> : null}
      {!loading && !error && drafts.length === 0 ? (
        <p className="mt-3 rounded-[5px] bg-[#292929] px-3 py-3 text-[11px] leading-5 text-[#999]">No changelog has been approved for this version.</p>
      ) : null}

      <div className="mt-3 space-y-3">
        {drafts.map((draft) => {
          const evidenceById = new Map(draft.evidence.map((evidence) => [evidence.id, evidence]));
          return (
            <article className="border-b border-[#383838] pb-4 last:border-b-0" key={draft.id}>
              <h3 className="text-[12px] font-semibold leading-5 text-[#e5e5e5]">{draft.title}</h3>
              <p className="mt-1 text-[11px] leading-5 text-[#aaa]">{draft.summary}</p>
              <div className="mt-3 space-y-3">
                {draft.statements.map((statement, index) => (
                  <section className="rounded-[5px] bg-[#292929] p-2.5" key={`${draft.id}-${index}`}>
                    <h4 className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#929292]">{audienceLabels[statement.audience]}</h4>
                    <p className="mt-1 text-[11px] leading-5 text-[#d0d0d0]">{statement.text}</p>
                    {statement.evidence.length ? (
                      <ul className="mt-2 space-y-1.5">
                        {statement.evidence.map((evidenceId) => {
                          const evidence = evidenceById.get(evidenceId);
                          if (!evidence) return null;
                          const target = evidence.sourceNodeId ? "element" : "screen";
                          return (
                            <li key={evidence.id}>
                              <details className="rounded-[4px] bg-[#222] px-2 py-1.5">
                                <summary className="cursor-pointer text-[10px] font-medium text-[#bcbcbc] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Evidence · {evidence.label}</summary>
                                <p className="mt-1.5 text-[10px] leading-4 text-[#999]">{evidence.details}</p>
                                <a
                                  className="mt-2 inline-flex min-h-8 items-center rounded-[4px] px-2 text-[10px] font-medium text-[#d0d0d0] underline decoration-[#666] underline-offset-2 hover:bg-[#343434] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
                                  href={evidenceCanvasHref(versionHrefPrefix, evidence)}
                                  aria-label={`Open ${evidence.label} ${target} in the canvas`}
                                >
                                  Open {target} in canvas ↗
                                </a>
                              </details>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
