"use client";

import { useState } from "react";

export function ProjectPdInChargeForm({ input }: {
  input: { workspaceId: string; projectId: string; candidates: Array<{ id: string; name: string; email: string; role: "owner" | "designer" }>; selectedId: string | null };
}) {
  const [selectedId, setSelectedId] = useState(input.selectedId ?? "");
  const [savedId, setSavedId] = useState(input.selectedId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Saves as soon as someone is picked; a failed save puts the previous choice back.
  async function save(nextId: string) {
    const previousId = savedId;
    setSelectedId(nextId);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/pd-in-charge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdInChargeUserId: nextId || null }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not update the PD in charge.");
      setSavedId(nextId);
      setNotice(nextId ? `Saved. ${input.candidates.find((candidate) => candidate.id === nextId)?.name ?? "They"} now leads this project.` : "Saved. No one leads this project now.");
    } catch (cause) {
      setSelectedId(previousId);
      setError(cause instanceof Error ? cause.message : "Could not update the PD in charge.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace-pane p-5" aria-labelledby="pd-in-charge-title">
      <h2 className="text-sm font-semibold tracking-[-0.02em] text-foreground" id="pd-in-charge-title">PD in charge</h2>
      <p className="mt-1.5 text-[13px] leading-5 text-foreground-muted">The owner or designer who leads this project. Changes save right away.</p>
      <label className="sr-only" htmlFor="project-pd-in-charge">PD in charge</label>
      <select
        className="mt-4 min-h-11 w-full rounded-control border border-transparent bg-surface-inset px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        disabled={saving}
        id="project-pd-in-charge"
        onChange={(event) => void save(event.target.value)}
        value={selectedId}
      >
        <option value="">Unassigned</option>
        {input.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.role === "owner" ? "Owner" : "Designer"} · {candidate.email}</option>)}
      </select>
      <p aria-live="polite" className={"mt-2 min-h-4 text-xs " + (error ? "text-danger" : "text-foreground-subtle")} role={error ? "alert" : undefined}>{saving ? "Saving…" : error || notice}</p>
    </section>
  );
}
