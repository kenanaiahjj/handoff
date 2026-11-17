"use client";

import { useState } from "react";
import type { Measurement } from "@asbir/snapshot-contract";
import { formatPrecisePixelValue } from "./format-captured-measurement";
import { formatLength, useMeasureUnit } from "./measure-unit";

type MeasurementRowProps = {
  label: string;
  measurement: Measurement;
};

export function MeasurementRow({ label, measurement }: MeasurementRowProps) {
  const [copied, setCopied] = useState(false);
  const unit = useMeasureUnit();
  const displayValue = measurement.value === null
    ? "—"
    : measurement.unit === "px" ? formatLength(measurement.value, unit) : formatPrecisePixelValue(measurement.value) + " " + measurement.unit;

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
    <div className="dial-row flex h-9 items-center justify-between gap-3 pl-3 pr-1">
      <dt className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-5 text-foreground-muted">
        <span className="truncate">{label}</span>
        {measurement.provenance === "measured" ? (
          <span className="shrink-0 rounded-chip bg-surface-strong px-1.5 text-[10px] leading-4 text-foreground-subtle" title="Measured from the captured bounds, not a Figma property">measured</span>
        ) : null}
      </dt>
      <dd className="shrink-0">
        <button
          aria-label={"Copy " + label + " value " + displayValue}
          className="rounded-chip px-2 py-1 font-mono text-[13px] font-medium leading-5 tabular-nums text-foreground transition-colors hover:bg-surface-strong disabled:cursor-default disabled:text-foreground-subtle disabled:hover:bg-transparent"
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
