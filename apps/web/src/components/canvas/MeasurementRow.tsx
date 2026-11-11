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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-[#3a3a3a]/70 py-2.5 last:border-b-0">
      <dt className="min-w-0 self-center text-[12px] leading-5 text-[#b8b8b8]">{label}</dt>
      <dd className="min-w-0 self-center justify-self-end">
        <button
          aria-label={"Copy " + label + " value " + displayValue}
          className="font-mono text-[14px] leading-5 tabular-nums text-[#ededed] hover:text-white hover:underline disabled:cursor-default disabled:hover:no-underline"
          disabled={measurement.value === null}
          onClick={copyValue}
          title={copied ? "Copied" : "Click to copy"}
          type="button"
        >
          {copied ? "Copied" : displayValue}
        </button>
      </dd>
      <dd className="col-span-2 flex min-w-0 flex-col gap-1 text-[12px] leading-4 text-[#bdbdbd]">
        <span>{provenanceLabels[measurement.provenance]}</span>
        {measurement.sourceProperty ? (
          <code className="block min-w-0 whitespace-normal text-left font-mono text-[12px] leading-4 text-[#bdbdbd] [overflow-wrap:anywhere]" title={measurement.sourceProperty}>
            {measurement.sourceProperty}
          </code>
        ) : null}
      </dd>
    </div>
  );
}
