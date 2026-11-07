"use client";

import { useState, type FormEvent } from "react";
import type { ProjectRules } from "@/src/server/services/layout-rules";

type ProjectRulesFormProps = {
  workspaceId: string;
  projectId: string;
  initialRules: ProjectRules;
};

const categories = ["color", "typography", "spacing"] as const;

export function ProjectRulesForm({ workspaceId, projectId, initialRules }: ProjectRulesFormProps) {
  const [spacing, setSpacing] = useState(initialRules.allowedSpacing.join(", "));
  const [requiredTokens, setRequiredTokens] = useState<ProjectRules["requireTokenCategories"]>(initialRules.requireTokenCategories);
  const [minWidth, setMinWidth] = useState(initialRules.frameBounds?.minWidth?.toString() ?? "");
  const [maxWidth, setMaxWidth] = useState(initialRules.frameBounds?.maxWidth?.toString() ?? "");
  const [minHeight, setMinHeight] = useState(initialRules.frameBounds?.minHeight?.toString() ?? "");
  const [maxHeight, setMaxHeight] = useState(initialRules.frameBounds?.maxHeight?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const spacingValues = spacing.split(",").map((value) => value.trim()).filter(Boolean).map(Number);
    if (spacingValues.some((value) => !Number.isFinite(value) || value < 0)) {
      setSaving(false);
      setMessage("Use comma-separated, non-negative numbers for spacing.");
      return;
    }
    const parseBound = (value: string) => value.trim() ? Number(value) : null;
    const frameBounds = [minWidth, maxWidth, minHeight, maxHeight].some((value) => value.trim())
      ? { minWidth: parseBound(minWidth), maxWidth: parseBound(maxWidth), minHeight: parseBound(minHeight), maxHeight: parseBound(maxHeight) }
      : null;
    if (frameBounds && Object.values(frameBounds).some((value) => value !== null && (!Number.isFinite(value) || value <= 0))) {
      setSaving(false);
      setMessage("Frame size limits must be positive numbers.");
      return;
    }

    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedSpacing: [...new Set(spacingValues)],
          requireTokenCategories: requiredTokens,
          frameBounds,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save these rules.");
      setMessage("Project rules saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not save these rules.");
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(category: typeof categories[number]) {
    setRequiredTokens((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  }

  return (
    <form className="space-y-5" onSubmit={save}>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="allowed-spacing">Approved spacing values</label>
        <input className="min-h-11 w-full rounded-control border border-border bg-background px-3 font-mono text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" id="allowed-spacing" onChange={(event) => setSpacing(event.target.value)} placeholder="4, 8, 12, 16" value={spacing} />
        <p className="mt-1 text-[10px] leading-4 text-foreground-subtle">Handoff flags captured padding and layout gaps outside this scale.</p>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-foreground">Require token bindings</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {categories.map((category) => (
            <label className="flex min-h-10 items-center gap-2 rounded-control bg-background px-3 text-xs text-foreground-muted" key={category}>
              <input checked={requiredTokens.includes(category)} onChange={() => toggleCategory(category)} type="checkbox" />
              <span className="capitalize">{category}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-4 text-foreground-subtle">The source capture must identify each token category for this check to pass.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-foreground">Frame size limits</legend>
        <div className="grid grid-cols-2 gap-2">
          {([[
            "Minimum width", minWidth, setMinWidth,
          ], ["Maximum width", maxWidth, setMaxWidth], ["Minimum height", minHeight, setMinHeight], ["Maximum height", maxHeight, setMaxHeight]] as const).map(([label, value, setter]) => (
            <label className="grid gap-1 text-[10px] text-foreground-subtle" key={label}>
              {label} (source units)
              <input className="min-h-10 w-full rounded-control border border-border bg-background px-3 font-mono text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" min="0" onChange={(event) => setter(event.target.value)} type="number" value={value} />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-foreground-muted">{message}</p>
        <button className="min-h-10 rounded-control bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={saving} type="submit">{saving ? "Saving…" : "Save rules"}</button>
      </div>
    </form>
  );
}
