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

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/pd-in-charge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdInChargeUserId: selectedId || null }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not update the PD in charge.");
      setSavedId(selectedId);
      setNotice(selectedId ? "PD in charge updated." : "PD in charge cleared.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the PD in charge.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-project-panel border border-border bg-surface p-5" aria-labelledby="pd-in-charge-title">
      <h2 className="text-sm font-semibold tracking-[-0.02em] text-foreground" id="pd-in-charge-title">PD in charge</h2>
      <p className="mt-2 text-[13px] leading-5 text-foreground-muted">Assign a workspace Owner or Designer to lead this project. Owners can also act as PDs, and Designers do not need workspace ownership.</p>
      <label className="mt-5 block text-xs font-medium text-foreground-muted" htmlFor="project-pd-in-charge">PD in charge</label>
      <select
        className="mt-2 min-h-11 w-full rounded-xl border border-border bg-surface-inset px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        id="project-pd-in-charge"
        onChange={(event) => setSelectedId(event.target.value)}
        value={selectedId}
      >
        <option value="">Unassigned</option>
        {input.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.role === "owner" ? "Owner" : "Designer"} · {candidate.email}</option>)}
      </select>
      <button className="mt-4 min-h-10 rounded-full border border-border-strong bg-surface-raised px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-raised/80 disabled:cursor-not-allowed disabled:opacity-50" disabled={saving || selectedId === savedId} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save assignment"}</button>
      {error ? <p className="mt-3 text-xs text-danger" role="alert">{error}</p> : notice ? <p aria-live="polite" className="mt-3 text-xs text-foreground-muted">{notice}</p> : null}
    </section>
  );
}
