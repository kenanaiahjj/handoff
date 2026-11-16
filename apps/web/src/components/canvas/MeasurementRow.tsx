"use client";

import { useState } from "react";
import type { Measurement } from "@asbir/snapshot-contract";
import { formatPrecisePixelValue } from "./format-captured-measurement";

type MeasurementRowProps = {
  label: string;
  measurement: Measurement;
};

export function MeasurementRow({ label, measurement }: MeasurementRowProps) {
  const [copied, setCopied] = useState(false);
  const displayValue = measurement.value === null
    ? "—"
    : (measurement.unit === "px" ? formatPrecisePixelValue(measurement.value) : String(measurement.value)) + " " + measurement.unit;

  async function copyValue() {
    if (measurement.value === null) return;
    try {
      await navigator.clipboard.writeText(displayValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-8 items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <dt className="flex min-w-0 items-center gap-1.5 text-[12px] leading-5 text-foreground-muted">
        <span className="truncate">{label}</span>
        {measurement.provenance === "measured" ? (
          <span className="shrink-0 rounded-full bg-surface-raised px-1.5 text-[10px] leading-4 text-foreground-subtle" title="Measured from the captured bounds, not a Figma property">measured</span>
        ) : null}
      </dt>
      <dd className="shrink-0">
        <button
          aria-label={"Copy " + label + " value " + displayValue}
          className="rounded-md px-1.5 py-0.5 font-mono text-[13px] leading-5 tabular-nums text-foreground transition-colors hover:bg-surface-raised disabled:cursor-default disabled:text-foreground-subtle disabled:hover:bg-transparent"
          disabled={measurement.value === null}
          onClick={copyValue}
          title={copied ? "Copied" : measurement.value === null ? "Not available in this capture" : "Click to copy"}
          type="button"
        >
          {copied ? "Copied" : displayValue}
        </button>
      </dd>
    </div>
  );
}
