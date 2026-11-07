"use client";

import { useId, useState } from "react";

type ExportFormat = "image/png" | "image/jpeg";
export type AssetExportTarget = {
  id: string;
  name: string;
  kind: "overview" | "frame";
  imageUrl: string;
  fileName: string;
  pixelWidth: number;
  pixelHeight: number;
};

export function AssetExportMenu({ targets }: { targets: AssetExportTarget[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState(targets[0]?.id ?? "");
  const selectId = useId();
  const target = targets.find((candidate) => candidate.id === selectedTargetId) ?? targets[0];
  const baseName = target?.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "snapshot";

  async function exportVector() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(target.imageUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("The vector render could not be loaded.");
      const blob = await response.blob();
      if (blob.type !== "image/svg+xml") throw new Error("This render does not contain vector source data.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}.svg`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The vector render could not be exported.");
    } finally {
      setBusy(false);
    }
  }

  async function exportAs(format: ExportFormat) {
    if (!target) return;
    setBusy(true);
    setError(null);
    let bitmap: ImageBitmap | null = null;
    try {
      const response = await fetch(target.imageUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("The frame image could not be loaded.");
      bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not prepare this image.");
      if (format === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, 0.92));
      if (!blob) throw new Error("The browser could not export this image.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}.${format === "image/png" ? "png" : "jpg"}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be exported.");
    } finally {
      bitmap?.close();
      setBusy(false);
    }
  }

  return (
    <details className="relative">
      <summary className="grid size-8 cursor-pointer list-none place-items-center rounded-control text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Export image" title="Export image">
        <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
          <path d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 10.5v2h10v-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
        </svg>
      </summary>
      <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-surface border border-border bg-surface p-3 shadow-xl">
        <p className="font-mono text-[9px] uppercase tracking-wide text-foreground-subtle">Export image</p>
        <label className="mt-2 block text-[10px] text-foreground-muted" htmlFor={selectId}>Canvas image</label>
        <select
          className="mt-1 min-h-9 w-full rounded-control border border-border bg-background px-2 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          disabled={!targets.length || busy}
          id={selectId}
          onChange={(event) => {
            setSelectedTargetId(event.target.value);
            setError(null);
          }}
          value={target?.id ?? ""}
        >
          {targets.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.kind === "overview" ? "Canvas overview" : `Screen · ${candidate.name}`}
            </option>
          ))}
        </select>
        {target ? <p className="mt-1.5 text-[10px] text-foreground-subtle">Stored image: {target.pixelWidth} × {target.pixelHeight} px</p> : null}
        <div className="mt-2 grid grid-cols-2 gap-1">
          {target?.fileName.toLowerCase().endsWith(".svg") ? <button className="col-span-2 min-h-9 rounded-control px-2 text-left text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50" disabled={busy} onClick={() => void exportVector()} type="button">SVG · vector source</button> : null}
          <button className="min-h-9 rounded-control bg-surface-inset px-2 text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50" disabled={!target || busy} onClick={() => void exportAs("image/png")} type="button">PNG</button>
          <button className="min-h-9 rounded-control bg-surface-inset px-2 text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50" disabled={!target || busy} onClick={() => void exportAs("image/jpeg")} type="button">JPEG</button>
        </div>
        {error ? <p aria-live="assertive" className="mt-2 text-[10px] text-warning">{error}</p> : null}
      </div>
    </details>
  );
}
