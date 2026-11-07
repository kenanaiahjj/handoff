"use client";

import { useState } from "react";
import type { Measurement } from "@asbir/snapshot-contract";
import { formatPixelValue } from "./format-captured-measurement";

const provenanceLabels = {
  source: "Source value",
  measured: "Measured distance",
  unavailable: "Unavailable",
} as const;

type MeasurementRowProps = {
  label: string;
  measurement: Measurement;
};

export function MeasurementRow({ label, measurement }: MeasurementRowProps) {
  const [copied, setCopied] = useState(false);
  const displayValue = measurement.value === null
    ? "—"
    : (measurement.unit === "px" ? formatPixelValue(measurement.value) : String(measurement.value)) + " " + measurement.unit;

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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[#3a3a3a]/70 py-2 last:border-b-0">
      <dt className="text-[11px] text-[#999]">{label}</dt>
      <dd>
        <button
          aria-label={"Copy " + label + " value " + displayValue}
          className="font-mono text-[11px] tabular-nums text-[#e1e1e1] hover:text-white hover:underline disabled:cursor-default disabled:hover:no-underline"
          disabled={measurement.value === null}
          onClick={copyValue}
          title={copied ? "Copied" : "Click to copy"}
          type="button"
        >
          {copied ? "Copied" : displayValue}
        </button>
      </dd>
      <dd className="col-span-2 flex items-center justify-between gap-3 text-[10px] text-[#888]">
        <span>{provenanceLabels[measurement.provenance]}</span>
        {measurement.sourceProperty ? <code className="truncate">{measurement.sourceProperty}</code> : null}
      </dd>
    </div>
  );
}
