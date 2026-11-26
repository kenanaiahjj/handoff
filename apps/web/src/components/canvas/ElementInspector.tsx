"use client";

import { useState } from "react";
import { showToast } from "@/src/components/shell/Toaster";
import { typographyFromTextSegments, type SnapshotNode } from "@asbir/snapshot-contract";
import type { HandoffComment } from "../comments/CommentPin";
import type { CanvasFrameOption } from "./FrameNavigator";
import { MeasurementRow } from "./MeasurementRow";
import { formatLength, measureUnits, setMeasureUnit, useMeasureUnit } from "./measure-unit";
import { InspectorExport } from "./InspectorExport";
import { formatFrameSize, formatPixelValue, formatPrecisePixelValue, formatWholeNumber, inspectionBounds, inspectionGeometryNotice, inspectionMeasurementEntries } from "./format-captured-measurement";
import { capturedGridTracks, formatGridTrack, shouldShowGridLayout } from "./grid-layout";
import { formatFigmaTextMetric, readPaintDetails, readTextStyleRuns, type TextStyleRun } from "./text-style-runs";
import { cssDifferences, cssTextForNode } from "./css-from-node";
import { comparisonChangeLabel, comparisonValueLabel, separateSupplementalChanges } from "./compare-presentation";
import { formatComparisonValue } from "./format-captured-measurement";
import type { SnapshotDiffChange } from "../../server/services/diff";

type ElementInspectorProps = {
  frame: CanvasFrameOption;
  selectedNode: SnapshotNode | null;
  frameCount: number;
  totalNodeCount: number;
  comments: HandoffComment[];
  canComment: boolean;
  canCompare: boolean;
  /** False when this role can't select single elements (Settings → Features by role). */
  canInspect?: boolean;
  /** False when this role can't download assets. */
  canExport?: boolean;
  onCompare: () => void;
  onAddComment: () => void;
  onSelectNode: (sourceNodeId: string) => void;
  onCopyLink: () => void | Promise<void>;
  inspecting?: boolean;
  /** Full elements for the selected screen; null until they load. */
  frameNodes?: SnapshotNode[] | null;
  /** The selected element's summary, shown while its full details load. */
  pendingNode?: { name: string; type: string; detailStatus: "idle" | "loading" | "error" | "ready" } | null;
  /** Owners and designers on the latest version can remove the selected screen. */
  onRemoveScreen?: () => void;
  removingScreen?: boolean;
  /** This screen is marked for removal in the next (unpublished) version. */
  screenMarkedForRemoval?: boolean;
  /** A second layer picked with Shift+click; the inspector lists where the two differ. */
  compareNode?: SnapshotNode | null;
  onClearCompare?: () => void;
  /** Lights up every layer using this colour and lists them in search. */
  onFindColor?: (color: string) => void;
  /** What changed on the selected element since the earlier version. */
  nodeChanges?: SnapshotDiffChange[];
  earlierVersionLabel?: string | null;
  /** Starts a comment on the element with this text filled in. */
  onCommentWithDraft?: (draft: string) => void;
};

/** "Width: 343px → 320px" lines for a change comment. */
function changeDraft(changes: SnapshotDiffChange[], earlierVersionLabel: string | null | undefined) {
  const lines = changes.map((change) => `- ${comparisonChangeLabel(change)}: ${comparisonValueLabel(change, "before", formatComparisonValue)} → ${comparisonValueLabel(change, "after", formatComparisonValue)}`);
  return `Changed since ${earlierVersionLabel ? "v" + earlierVersionLabel : "the last version"}:\n${lines.join("\n")}\n\n`;
}

function FindColorButton({ color, onFind }: { color: string; onFind?: (color: string) => void }) {
  if (!onFind) return null;
  return (
    <button
      aria-label={`Find layers using ${color}`}
      className="grid size-5 shrink-0 place-items-center rounded-[5px] text-foreground-subtle hover:bg-white/[0.08] hover:text-foreground"
      onClick={() => onFind(color)}
      title="Find every layer using this colour"
      type="button"
    >
      <svg aria-hidden="true" className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></svg>
    </button>
  );
}

function valueText(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function measurementText(value: unknown, unit = "px") {
  if (typeof value !== "number") return valueText(value);
  return ["px", "pixel", "pixels"].includes(unit.trim().toLowerCase())
    ? formatLength(value)
    : formatWholeNumber(value);
}

function typographyMeasurementText(measurement: NonNullable<SnapshotNode["typography"]>["fontSize"]) {
  if (measurement.value === null) return measurement.unit === "auto" ? "Auto" : "Unavailable";
  const unit = measurement.unit.toLowerCase();
  if (unit === "px" || unit === "pixels") return formatLength(measurement.value);
  if (unit === "percent" || unit === "%") return `${formatFigmaTextMetric(measurement.value)}%`;
  return `${formatFigmaTextMetric(measurement.value)} ${measurement.unit}`;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function availableProperties(entries: Array<{ label: string; value: unknown }>) {
  return entries.flatMap(({ label, value }) => {
    if (value === null || value === undefined || value === "") return [];
    return [{ label, value: String(value) }];
  });
}

function capturedLayoutGrids(node: SnapshotNode) {
  const value = node.sourcePayload.layoutGrids;
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((grid) => {
    if (typeof grid !== "object" || grid === null || Array.isArray(grid)) return [];
    return [grid as Record<string, unknown>];
  });
}

function nodePaintDetails(node: SnapshotNode, field: "fillPaintDetails" | "strokePaintDetails", fallback: SnapshotNode["fills"]) {
  const sourcePaints = node.sourcePayload[field];
  return readPaintDetails(Array.isArray(sourcePaints) && sourcePaints.length ? sourcePaints : fallback);
}

function paintTypeLabel(type: string) {
  return type.replace(/^GRADIENT_/, "").toLowerCase().replaceAll("_", " ") + " paint";
}

function percentText(value: number | null) {
  if (value === null) return "Unavailable";
  return `${Number((value * 100).toFixed(2))}%`;
}

function MeasurementGroup({
  title,
  values,
  description,
}: {
  title: string;
  values: Record<string, { value: number | null; unit: string; provenance: "source" | "measured" | "unavailable"; sourceProperty: string | null }>;
  description?: string | null;
}) {
  // Only values Figma itself stores. Anything we derived from geometry ("measured") or couldn't
  // read is left out: a dev should be able to type every number here straight into code.
  const entries = inspectionMeasurementEntries(values).filter(([, measurement]) => measurement.provenance === "source" && measurement.value !== null);
  if (!entries.length) return null;

  return (
    <section className="border-t border-white/[0.06] pt-3">
      <h3 className="dial-section-title mb-2">{title}</h3>
      {description ? <p className="mb-2 text-[11px] leading-4 text-foreground-subtle">{description}</p> : null}
      <dl className="space-y-1.5">
        {entries.map(([label, measurement]) => (
          <MeasurementRow key={label} label={label} measurement={measurement} />
        ))}
      </dl>
    </section>
  );
}

function CopyValue({ label, value, displayValue = value, className }: { label: string; value: string; displayValue?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={"Copy " + label}
      className={className ?? "block min-w-0 max-w-full whitespace-normal break-all text-left font-mono text-[11px] text-foreground [overflow-wrap:anywhere] hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          showToast(`Copied ${value.length > 40 ? label : value}`);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          setCopied(false);
        }
      }}
      title={copied ? "Copied" : "Click to copy"}
      type="button"
    >
      {copied ? "Copied" : displayValue}
    </button>
  );
}

/** A typography value: copyable when it's a real value, plain text for "Mixed…" or "Unavailable". */
function InspectorValue({ label, value }: { label: string; value: string }) {
  if (value === "Unavailable" || value.startsWith("Mixed")) return <>{value}</>;
  return <CopyValue className="max-w-full truncate text-right text-[12px] text-foreground hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" label={label} value={value} />;
}

function colorTokenValue(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
  if (![candidate.r, candidate.g, candidate.b].every((channel) => typeof channel === "number" && Number.isFinite(channel))) return null;
  const channels = [candidate.r, candidate.g, candidate.b].map((channel) => Math.max(0, Math.min(255, Math.round((channel as number) * 255))));
  const alpha = typeof candidate.a === "number" && Number.isFinite(candidate.a) ? Math.max(0, Math.min(1, candidate.a)) : 1;
  const text = alpha < 1
    ? `rgba(${channels.join(", ")}, ${Number(alpha.toFixed(3))})`
    : `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  return { text, swatch: `rgba(${channels.join(", ")}, ${alpha})` };
}

function TokenValue({ token }: { token: SnapshotNode["tokens"][number] }) {
  const color = token.category === "color" ? colorTokenValue(token.value) : null;
  return (
    <div className="flex min-w-0 items-start gap-2">
      {color ? <span aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 rounded-chip border border-white/20" style={{ backgroundColor: color.swatch }} /> : null}
      <div className="min-w-0 flex-1"><CopyValue label={token.name} value={color?.text ?? valueText(token.value)} /></div>
    </div>
  );
}

function TextStyleRuns({ runs }: { runs: TextStyleRun[] }) {
  if (!runs.length) return null;

  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-[11px] text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        Text styles <span className="text-foreground-subtle">· {runs.length} {runs.length === 1 ? "run" : "runs"}</span>
      </summary>
      <div className="mt-2 space-y-1.5">
        {runs.map((run, index) => {
          const excerpt = run.characters.replace(/\s+/g, " ").trim() || "Empty text run";
          const properties = availableProperties([
            { label: "Font", value: [run.fontFamily, run.fontStyle].filter(Boolean).join(" · ") },
            { label: "Size", value: run.fontSize === null ? null : formatLength(run.fontSize) },
            { label: "Weight", value: run.fontWeight },
            { label: "Line height", value: measurementText(run.lineHeight) },
            { label: "Letter spacing", value: measurementText(run.letterSpacing) },
          ]);
          return (
            <details className="rounded-control bg-surface-inset px-2.5 py-2" key={`${run.start}:${run.end}`}>
              <summary className="flex cursor-pointer items-center justify-between gap-2 text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <span className="min-w-0 truncate text-foreground-muted" title={run.characters}>{excerpt}</span>
                <span className="shrink-0 font-mono text-foreground-subtle">{run.fontSize === null ? `Run ${index + 1}` : formatLength(run.fontSize)}</span>
              </summary>
              {properties.length ? (
                <dl className="mt-2 space-y-1.5 text-[10px]">
                  {properties.map((property) => (
                    <div className="flex justify-between gap-3" key={property.label}>
                      <dt className="text-foreground-subtle">{property.label}</dt>
                      <dd className={property.label === "Size" || property.label === "Line height" || property.label === "Letter spacing" ? "font-mono break-words text-right text-foreground-muted" : "break-words text-right text-foreground-muted"}>
                        {property.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {run.fills.length ? (
                <div className="mt-2 space-y-1.5">
                  {run.fills.map((fill, fillIndex) => (
                    <div className="rounded-chip border border-border px-2 py-1.5" key={`${fill.type}:${fillIndex}`}>
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-foreground-subtle">Text fill · {fill.type.toLowerCase()}</span>
                        {fill.opacity !== null ? <span className="font-mono text-foreground-subtle">{Math.round(fill.opacity * 100)}%</span> : null}
                      </div>
                      {fill.color ? (
                        <div className="mt-1 flex items-center gap-2">
                          <span aria-hidden="true" className="size-3.5 shrink-0 rounded-chip border border-border-strong" style={{ backgroundColor: fill.color }} />
                          <CopyValue label={`Text fill ${fillIndex + 1}`} value={fill.color} />
                        </div>
                      ) : null}
                      {fill.gradientStops.length ? (
                        <ul className="mt-1 space-y-1">
                          {fill.gradientStops.map((stop, stopIndex) => (
                            <li className="flex items-center justify-between gap-2" key={stopIndex}>
                              <span className="flex min-w-0 items-center gap-2">
                                {stop.color ? <span aria-hidden="true" className="size-3.5 shrink-0 rounded-chip border border-border-strong" style={{ backgroundColor: stop.color }} /> : null}
                                <span className="text-foreground-subtle">Stop {stopIndex + 1}{stop.position === null ? "" : ` · ${Math.round(stop.position * 100)}%`}{stop.opacity === null ? "" : ` · ${Math.round(stop.opacity * 100)}%`}</span>
                              </span>
                              {stop.color ? <CopyValue label={`Gradient stop ${stopIndex + 1}`} value={stop.color} /> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {run.tokens.length ? (
                <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
                  {run.tokens.map((token) => (
                    <li key={token.sourceId + (token.bindingPath ?? "binding")}>
                      <p className="text-[10px] font-medium text-foreground-muted">{token.name}</p>
                      {token.bindingPath ? <p className="mt-0.5 break-all font-mono text-[9px] text-foreground-subtle">{token.bindingPath}</p> : null}
                      <div className="mt-0.5"><CopyValue label={token.name} value={valueText(token.value)} /></div>
                      <p className="mt-0.5 text-[9px] text-foreground-subtle">{token.collectionName ?? "Uncategorized"}{token.mode ? ` · ${token.mode}` : ""}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {run.textStyleId || run.fillStyleId ? (
                <p className="mt-2 break-all border-t border-border pt-1.5 font-mono text-[9px] text-foreground-subtle">
                  {[run.textStyleId ? `Text style ${run.textStyleId}` : null, run.fillStyleId ? `Fill style ${run.fillStyleId}` : null].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </details>
          );
        })}
      </div>
    </details>
  );
}

export function ElementInspector({
  frame,
  selectedNode,
  frameCount,
  totalNodeCount,
  comments,
  canComment,
  canCompare,
  canInspect = true,
  canExport = true,
  onCompare,
  onAddComment,
  onSelectNode,
  onCopyLink,
  inspecting = false,
  frameNodes = null,
  pendingNode = null,
  onRemoveScreen,
  removingScreen = false,
  screenMarkedForRemoval = false,
  compareNode = null,
  onClearCompare,
  onFindColor,
  nodeChanges = [],
  earlierVersionLabel = null,
  onCommentWithDraft,
}: ElementInspectorProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  // Re-render when the unit changes; the helpers above read it when formatting.
  const measureUnit = useMeasureUnit();
  const textStyleRuns = selectedNode
    ? readTextStyleRuns(
        selectedNode.sourcePayload,
        selectedNode.tokens.map((token) => ({
          sourceId: token.sourceId,
          bindingPath: token.bindingPath ?? null,
          name: token.name,
          category: token.category ?? "other",
          value: token.value,
          collectionName: token.collectionName,
          mode: token.mode,
        })),
      )
    : [];
  const selectedTypography = selectedNode
    ? typographyFromTextSegments(selectedNode.typography, selectedNode.sourcePayload)
    : null;
    const appearancePaints = selectedNode
      ? [
          ...nodePaintDetails(selectedNode, "fillPaintDetails", selectedNode.fills).map((paint, index) => ({ ...paint, label: `Fill ${index + 1}` })),
          ...nodePaintDetails(selectedNode, "strokePaintDetails", selectedNode.strokes).map((paint, index) => ({ ...paint, label: `Stroke ${index + 1}` })),
        ]
      : [];
  const selectedBounds = selectedNode ? inspectionBounds(selectedNode) : null;
  const layerExport = selectedNode ? frame.layerExports?.[selectedNode.sourceNodeId] ?? null : null;
  const uniformRadius = finiteNumber(selectedNode?.sourcePayload.cornerRadius);
  const isGridContainer = selectedNode ? shouldShowGridLayout({
    mode: selectedNode.layout.mode,
    gridColumnCount: selectedNode.layout.constraints.gridColumnCount,
    gridRowCount: selectedNode.layout.constraints.gridRowCount,
    gridColumnSizes: selectedNode.sourcePayload.gridColumnSizes,
    gridRowSizes: selectedNode.sourcePayload.gridRowSizes,
  }) : false;
  const gridParentNode = selectedNode?.parentSourceNodeId
    ? frameNodes?.find((node) => node.sourceNodeId === selectedNode.parentSourceNodeId) ?? null
    : null;
  const isGridItem = gridParentNode ? shouldShowGridLayout({
    mode: gridParentNode.layout.mode,
    gridColumnCount: gridParentNode.layout.constraints.gridColumnCount,
    gridRowCount: gridParentNode.layout.constraints.gridRowCount,
    gridColumnSizes: gridParentNode.sourcePayload.gridColumnSizes,
    gridRowSizes: gridParentNode.sourcePayload.gridRowSizes,
  }) : false;
  const gridColumnTracks = capturedGridTracks(selectedNode?.sourcePayload.gridColumnSizes);
  const gridRowTracks = capturedGridTracks(selectedNode?.sourcePayload.gridRowSizes);
  const gridRowIndex = finiteNumber(selectedNode?.sourcePayload.gridRowAnchorIndex);
  const gridColumnIndex = finiteNumber(selectedNode?.sourcePayload.gridColumnAnchorIndex);
  const radiusFields = [
    ["Top left", finiteNumber(selectedNode?.sourcePayload.topLeftRadius)],
    ["Top right", finiteNumber(selectedNode?.sourcePayload.topRightRadius)],
    ["Bottom right", finiteNumber(selectedNode?.sourcePayload.bottomRightRadius)],
    ["Bottom left", finiteNumber(selectedNode?.sourcePayload.bottomLeftRadius)],
  ] as const;
  const resolvedRadiusFields = radiusFields.flatMap(([label, value]) => {
    const resolvedValue = value ?? uniformRadius;
    return resolvedValue === null ? [] : [{ label, value: resolvedValue }];
  });
  const radiiAreUniform = resolvedRadiusFields.length === 4
    && resolvedRadiusFields.every(({ value }) => value === resolvedRadiusFields[0].value);
  const radiusDisplayFields = radiiAreUniform
    ? [{ label: "Corner radius", value: resolvedRadiusFields[0].value }]
    : resolvedRadiusFields;
  // Figma shows rotation and opacity only when set; float noise like 1e-14° counts as unset.
  const rawRotation = finiteNumber(selectedNode?.sourcePayload.rotation);
  const rotation = rawRotation !== null && Math.abs(rawRotation) >= 0.005 ? rawRotation : null;
  const opacity = finiteNumber(selectedNode?.sourcePayload.opacity);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setTextCopied(true);
      window.setTimeout(() => setTextCopied(false), 1200);
    } catch {
      setTextCopied(false);
    }
  }

  async function copyCss() {
    if (!selectedNode) return;
    try {
      await navigator.clipboard.writeText(cssTextForNode(selectedNode));
      showToast("Copied CSS for " + (selectedNode.name || "this layer"));
    } catch {
      showToast("The browser blocked copying");
    }
  }
  const visibleChanges = separateSupplementalChanges(nodeChanges).visible;
  const differences = selectedNode && compareNode && compareNode.sourceNodeId !== selectedNode.sourceNodeId ? cssDifferences(selectedNode, compareNode) : null;
  const css = selectedNode ? cssTextForNode(selectedNode) : "";

  async function copyLink() {
    try {
      await onCopyLink();
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1200);
    } catch {
      setLinkCopied(false);
    }
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface px-4 py-4 text-foreground-muted">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-subtle">Properties</h2>
        <div aria-label="Measurement unit" className="dial-segmented h-7 shrink-0" role="group">
          {measureUnits.map((unit) => (
            <button
              aria-pressed={measureUnit === unit}
              className="min-h-6 px-2 font-mono text-[11px]"
              key={unit}
              onClick={() => setMeasureUnit(unit)}
              title={unit === "rem" ? "rem, with a 16 px root" : unit === "px" ? "Pixels" : unit === "pt" ? "iOS points (1x)" : "Android dp (1x)"}
              type="button"
            >
              {unit}
            </button>
          ))}
        </div>
      </div>

      {!selectedNode && pendingNode ? (
        <div aria-busy={pendingNode.detailStatus !== "error"} className="mt-4" role="status">
          <p className="break-words text-[13px] font-semibold text-foreground">{pendingNode.name || "Unnamed element"}</p>
          <span className="mt-1 inline-block rounded-chip bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-foreground-subtle">{pendingNode.type}</span>
          {pendingNode.detailStatus === "error" ? (
            <p className="mt-4 text-[12px] text-warning">Couldn’t load this element’s details. Select it again to retry.</p>
          ) : (
            <div aria-hidden="true" className="mt-5 space-y-3">
              {[72, 56, 88, 64, 80].map((width, index) => (
                <div className="flex items-center justify-between gap-3" key={index}>
                  <span className="h-3 animate-pulse rounded bg-surface-raised" style={{ width: `${width / 2}%` }} />
                  <span className="h-3 w-12 animate-pulse rounded bg-surface-raised" />
                </div>
              ))}
              <span className="sr-only">Loading element details…</span>
            </div>
          )}
        </div>
      ) : selectedNode ? (
        <div className="mt-4">
          <div className="mb-4 min-w-0 rounded-[12px] border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 break-words text-[14px] font-semibold leading-5 tracking-[-0.01em] text-foreground">{selectedNode.name || "Unnamed element"}</p>
              {selectedNode.parentSourceNodeId ? (
                <button className="inspector-action shrink-0" onClick={() => onSelectNode(selectedNode.parentSourceNodeId!)} title="Select the parent layer" type="button">
                  <svg aria-hidden="true" className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M8 13V3.5M4 7.5l4-4 4 4" /></svg>
                  Parent
                </button>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-foreground-subtle">
              <span className="rounded-[5px] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">{selectedNode.type}</span>
              {!selectedNode.visible ? <span className="rounded-[5px] bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">Hidden layer</span> : null}
              {selectedBounds?.width.value != null && selectedBounds?.height.value != null ? (
                <span className="font-mono tabular-nums">{formatLength(selectedBounds.width.value).replace(/ \S+$/, "")} × {formatLength(selectedBounds.height.value)}</span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedTypography?.content ? <button className="inspector-action" onClick={() => void copyText(selectedTypography.content!)} title="Copy the exact text of this layer" type="button">{textCopied ? "Copied" : "Copy text"}</button> : null}
              <button className="inspector-action" onClick={copyCss} title="CSS from the values Figma stores for this layer (⌘⇧C copies it too)" type="button">Copy CSS</button>
              <button className="inspector-action" onClick={copyLink} title="A link that opens this screen with this element selected" type="button">{linkCopied ? "Copied" : "Copy link"}</button>
              {canComment ? <button className="inspector-action" onClick={onAddComment} type="button">Comment</button> : null}
              {canCompare ? <button className="inspector-action" onClick={onCompare} type="button">Compare</button> : null}
            </div>
          </div>

          {differences ? (
            <section aria-labelledby="inspector-compare-title" className="mb-4 rounded-[12px] border border-[#5aa9ff]/30 bg-[#5aa9ff]/[0.06] p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-[12px] font-medium text-foreground" id="inspector-compare-title">
                  Compared with <span className="text-[#8cc4ff]">{compareNode?.name || "the other layer"}</span>
                </h3>
                {onClearCompare ? <button className="inspector-action shrink-0" onClick={onClearCompare} title="Stop comparing (Esc)" type="button">Clear</button> : null}
              </div>
              {differences.length ? (
                <table className="mt-2 w-full table-fixed text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] text-foreground-subtle">
                      <th className="w-[34%] pb-1 font-normal">Property</th>
                      <th className="pb-1 font-normal">This</th>
                      <th className="pb-1 font-normal text-[#8cc4ff]">Other</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {differences.map((row) => (
                      <tr className="border-t border-white/[0.06] align-top" key={row.property}>
                        <td className="truncate py-1 pr-1 text-foreground-subtle" title={row.property}>{row.property}</td>
                        <td className="break-words py-1 pr-1 text-foreground">{row.first ?? "—"}</td>
                        <td className="break-words py-1 text-[#b9dbff]">{row.second ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="mt-1.5 text-[11px] text-foreground-muted">Same size, spacing, colours and text style.</p>}
              <p className="mt-2 text-[10px] text-foreground-subtle">Distances between them are drawn on the canvas.<span className="touch-hidden"> Shift+click another layer to compare with it instead.</span></p>
            </section>
          ) : null}

          {visibleChanges.length ? (
            <section aria-labelledby="inspector-changes-title" className="mb-4 rounded-[12px] border border-warning/25 bg-warning/[0.05] p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-medium text-foreground" id="inspector-changes-title">
                  Changed since {earlierVersionLabel ? "v" + earlierVersionLabel : "the last version"}
                </h3>
                {canComment && onCommentWithDraft ? (
                  <button className="inspector-action shrink-0" onClick={() => onCommentWithDraft(changeDraft(visibleChanges, earlierVersionLabel))} title="Start a comment on this element with these changes filled in" type="button">Comment</button>
                ) : null}
              </div>
              <ul className="mt-2 space-y-2">
                {visibleChanges.map((change, index) => (
                  <li className="text-[11px]" key={change.path + index}>
                    <p className="text-foreground-muted">{comparisonChangeLabel(change)}</p>
                    <p className="mt-0.5 break-words font-mono text-[11px] leading-4">
                      <span className="text-foreground-subtle line-through decoration-foreground-subtle/50">{comparisonValueLabel(change, "before", formatComparisonValue)}</span>
                      <span className="px-1.5 text-foreground-subtle">→</span>
                      <span className="text-foreground">{comparisonValueLabel(change, "after", formatComparisonValue)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canExport ? <InspectorExport
            element={{
              name: selectedNode.name || "element",
              bounds: { x: selectedNode.bounds.x.value, y: selectedNode.bounds.y.value, width: selectedNode.bounds.width.value, height: selectedNode.bounds.height.value },
              layerExport,
            }}
            frame={frame}
            key={selectedNode.sourceNodeId}
          /> : null}

          {css ? (
            <details className="group border-t border-border py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                <span className="dial-section-title">CSS</span>
                <span className="text-[10px] text-foreground-subtle group-open:hidden">Show</span>
              </summary>
              <pre className="mt-2 max-h-64 select-text overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-inset p-2.5 font-mono text-[11px] leading-[17px] text-foreground-muted">{css}</pre>
              <p className="mt-1.5 text-[10px] leading-4 text-foreground-subtle">Only values Figma stores. Fill and hug sizes follow their parent or content, so they aren’t fixed here.</p>
            </details>
          ) : null}

          {comments.length ? <section className="border-t border-border py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="dial-section-title">Comments on this element</h3>
              <span className="font-mono text-[10px] text-foreground-subtle">{comments.length}</span>
            </div>
            {comments.slice(0, 3).map((comment) => (
              <p className="mb-2 text-[11px] leading-5 text-foreground-muted" key={comment.id}><span className="font-medium text-foreground-muted">{comment.authorName}</span> · {comment.body}</p>
            ))}
          </section> : null}

            {selectedBounds ? <MeasurementGroup title="Layout" values={selectedBounds} /> : <p className="border-t border-white/[0.06] py-3 text-[11px] leading-4 text-foreground-subtle">{inspectionGeometryNotice(selectedNode)}</p>}
          {radiusDisplayFields.length || rotation || (opacity !== null && opacity < 1) ? <section className="border-t border-white/[0.06] pt-3">
            <h3 className="dial-section-title mb-2">Shape</h3>
            <dl className="space-y-1.5 text-[12px]">
              {radiusDisplayFields.map(({ label, value }) => (
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3" key={label}>
                  <dt className="text-foreground-subtle">{label}</dt>
                  <dd className="text-right"><CopyValue label={`${label.toLowerCase()} radius`} value={formatLength(value)} /></dd>
                </div>
              ))}
              {rotation ? <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Rotation</dt><dd className="text-right"><CopyValue label="rotation" value={`${formatPixelValue(rotation)}deg`} displayValue={`${formatPixelValue(rotation)}°`} /></dd></div> : null}
              {opacity !== null && opacity < 1 ? <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Opacity</dt><dd className="text-right"><CopyValue label="opacity" value={String(Number(opacity.toFixed(3)))} displayValue={percentText(opacity)} /></dd></div> : null}
            </dl>
          </section> : null}
          <MeasurementGroup title="Padding" values={selectedNode.padding} />
          <MeasurementGroup title="Spacing" values={selectedNode.spacing} />


          {isGridContainer ? (
            <section className="border-t border-white/[0.06] pt-3">
              <h3 className="dial-section-title mb-2">Grid layout</h3>
              <dl className="space-y-1.5 text-[12px]">
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Columns</dt><dd className="text-right text-foreground">{valueText(selectedNode.layout.constraints.gridColumnCount)}</dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Rows</dt><dd className="text-right text-foreground">{valueText(selectedNode.layout.constraints.gridRowCount)}</dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Column gap</dt><dd className="text-right text-foreground">{measurementText(selectedNode.spacing.columnGap.value, selectedNode.spacing.columnGap.unit)} {selectedNode.spacing.columnGap.unit}</dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Row gap</dt><dd className="text-right text-foreground">{measurementText(selectedNode.spacing.rowGap.value, selectedNode.spacing.rowGap.unit)} {selectedNode.spacing.rowGap.unit}</dd></div>
                {selectedNode.sourcePayload.gridAutoTracks !== undefined ? <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Automatic rows</dt><dd className="text-right text-foreground">{valueText(selectedNode.sourcePayload.gridAutoTracks)}</dd></div> : null}
                {selectedNode.sourcePayload.gridItemsPositioning !== undefined ? <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Item placement</dt><dd className="text-right text-foreground">{valueText(selectedNode.sourcePayload.gridItemsPositioning)}</dd></div> : null}
              </dl>
              {gridColumnTracks.length ? <p className="mt-2 break-words text-[10px] leading-4 text-foreground-subtle">Column tracks: {gridColumnTracks.map((track, index) => `${index + 1}. ${formatGridTrack(track)}`).join(" · ")}</p> : null}
              {gridRowTracks.length ? <p className="mt-1 break-words text-[10px] leading-4 text-foreground-subtle">Row tracks: {gridRowTracks.map((track, index) => `${index + 1}. ${formatGridTrack(track)}`).join(" · ")}</p> : null}
            </section>
          ) : null}

          {isGridItem ? (
            <section className="border-t border-white/[0.06] pt-3">
              <h3 className="dial-section-title mb-2">Grid item</h3>
              <dl className="space-y-1.5 text-[12px]">
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Cell</dt><dd className="text-right text-foreground">{[
                  gridRowIndex === null ? null : `Row ${Math.trunc(gridRowIndex) + 1}`,
                  gridColumnIndex === null ? null : `Column ${Math.trunc(gridColumnIndex) + 1}`,
                ].filter(Boolean).join(" · ") || "Unavailable"}</dd></div>
                {availableProperties([
                  { label: "Row span", value: selectedNode.sourcePayload.gridRowSpan },
                  { label: "Column span", value: selectedNode.sourcePayload.gridColumnSpan },
                  { label: "Horizontal alignment", value: selectedNode.sourcePayload.gridChildHorizontalAlign },
                  { label: "Vertical alignment", value: selectedNode.sourcePayload.gridChildVerticalAlign },
                ]).map((property) => (
                  <div className="flex justify-between gap-3" key={property.label}><dt className="text-foreground-subtle">{property.label}</dt><dd className="text-right text-foreground">{property.value}</dd></div>
                ))}
              </dl>
            </section>
          ) : null}

          {capturedLayoutGrids(selectedNode).length ? (
            <section className="border-t border-white/[0.06] pt-3">
              <h3 className="dial-section-title mb-2">Canvas grids</h3>
              <ul className="space-y-2">
                {capturedLayoutGrids(selectedNode).map((grid, index) => (
                  <li className="rounded-control bg-surface-inset p-2.5 text-[10px]" key={`${String(grid.pattern ?? "grid")}-${index}`}>
                    <p className="font-medium text-foreground">{String(grid.pattern ?? "Grid").toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}{typeof grid.visible === "boolean" && !grid.visible ? " · hidden" : ""}</p>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-foreground-subtle">
                      {(["count", "sectionSize", "gutterSize", "offset", "alignment"] as const).map((key) => grid[key] === undefined ? null : (
                        <div className="contents" key={key}><dt>{key === "sectionSize" ? "Size" : key === "gutterSize" ? "Gutter" : key === "alignment" ? "Alignment" : key === "offset" ? "Offset" : "Count"}</dt><dd className="truncate text-right text-foreground-muted">{measurementText(grid[key], ["sectionSize", "gutterSize", "offset"].includes(key) ? "px" : "")}</dd></div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="border-t border-white/[0.06] pt-3">
            <h3 className="dial-section-title mb-2">Appearance</h3>
            {appearancePaints.length ? (
              <div className="space-y-1.5">
                {appearancePaints.map((paint, index) => (
                  <div className="rounded-control bg-surface-inset px-2.5 py-2" key={paint.label + index}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[11px] text-foreground-muted">
                        <span aria-hidden="true" className="size-4 shrink-0 rounded-chip border border-border-strong" style={{ backgroundColor: paint.color ?? "transparent", opacity: paint.opacity ?? 1 }} />
                        <span className="truncate">{paint.label} · {paintTypeLabel(paint.type)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">{percentText(paint.opacity)}</span>
                    </div>
                    {paint.color ? (
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px]">
                        <span className="text-foreground-subtle">Color</span>
                        <span className="flex min-w-0 items-center gap-1">
                          <CopyValue label={`${paint.label} color`} value={paint.color} />
                          <FindColorButton color={paint.color} onFind={onFindColor} />
                        </span>
                      </div>
                    ) : null}
                    {paint.gradientStops.length ? (
                      <ul className="mt-1.5 space-y-1 border-t border-border pt-1.5">
                        {paint.gradientStops.map((stop, stopIndex) => (
                          <li className="flex items-center justify-between gap-2" key={stopIndex}>
                            <span className="flex min-w-0 items-center gap-2">
                              {stop.color ? <span aria-hidden="true" className="size-3.5 shrink-0 rounded-chip border border-border-strong" style={{ backgroundColor: stop.color, opacity: stop.opacity ?? 1 }} /> : null}
                              <span className="truncate text-[10px] text-foreground-subtle">Stop {stopIndex + 1}{stop.position === null ? "" : ` · ${percentText(stop.position)}`}{stop.opacity === null ? "" : ` · ${percentText(stop.opacity)} opacity`}</span>
                            </span>
                            {stop.color ? <CopyValue label={`${paint.label} gradient stop ${stopIndex + 1}`} value={stop.color} /> : <span className="text-[10px] text-foreground-subtle">Color unavailable</span>}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {!paint.color && !paint.gradientStops.length ? <p className="mt-1.5 text-[10px] text-foreground-subtle">No color value for this paint type.</p> : null}
                  </div>
                ))}
              </div>
            ) : <p className="text-[11px] text-foreground-subtle">No visible fills or strokes.</p>}
            {selectedNode.styleReferences.length ? (
              <ul className="mt-2 space-y-1">
                {selectedNode.styleReferences.map((style) => <li className="text-[11px] text-foreground-muted" key={style.kind + style.sourceStyleId}>{style.kind}: {style.name ?? style.sourceStyleId}</li>)}
              </ul>
            ) : null}
          </section>

          <section className="border-t border-white/[0.06] pt-3">
            <h3 className="dial-section-title mb-2">Typography</h3>
            {selectedTypography ? (
              <dl className="space-y-1.5 text-[12px]">
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Font</dt><dd className="max-w-40 truncate text-right text-foreground"><InspectorValue label="font" value={String(selectedTypography.fontFamily ?? (textStyleRuns.length > 1 ? "Mixed — see text styles" : "Unavailable"))} /></dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Size</dt><dd className="text-right text-foreground"><InspectorValue label="size" value={String(selectedTypography.fontSize.value === null && textStyleRuns.length > 1 ? "Mixed — see text styles" : typographyMeasurementText(selectedTypography.fontSize))} /></dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Weight</dt><dd className="text-right text-foreground"><InspectorValue label="weight" value={String(selectedTypography.fontWeight ?? (textStyleRuns.length > 1 ? "Mixed — see text styles" : "Unavailable"))} /></dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Line height</dt><dd className="text-right text-foreground"><InspectorValue label="line height" value={String(selectedTypography.lineHeight.value === null && textStyleRuns.length > 1 ? "Mixed — see text styles" : typographyMeasurementText(selectedTypography.lineHeight))} /></dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Letter spacing</dt><dd className="text-right text-foreground"><InspectorValue label="letter spacing" value={String(selectedTypography.letterSpacing.value === null && textStyleRuns.length > 1 ? "Mixed — see text styles" : typographyMeasurementText(selectedTypography.letterSpacing))} /></dd></div>
                <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Alignment</dt><dd className="text-right text-foreground"><InspectorValue label="alignment" value={String(selectedTypography.textAlign ?? "Unavailable")} /></dd></div>
                {selectedTypography.content !== null ? <div className="border-t border-border pt-2"><dt className="flex items-center justify-between gap-2 text-foreground-subtle">Text content<button className="rounded-chip px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:bg-surface-strong hover:text-foreground" onClick={() => void copyText(selectedTypography.content!)} type="button">{textCopied ? "Copied" : "Copy"}</button></dt><dd className="mt-1 select-text whitespace-pre-wrap break-words text-foreground">{selectedTypography.content}</dd></div> : null}
              </dl>
            ) : textStyleRuns.length ? <p className="text-[11px] text-foreground-subtle">Typography is captured per text run.</p> : <p className="text-[11px] text-foreground-subtle">No typography data captured.</p>}
            <TextStyleRuns runs={textStyleRuns} />
          </section>

          <section className="border-t border-white/[0.06] pt-3">
            <h3 className="dial-section-title mb-2">Bound tokens</h3>
            {selectedNode.tokens.length ? (
              <ul className="space-y-2">
                {selectedNode.tokens.map((token) => (
                  <li className="rounded-control bg-surface-inset p-2.5" key={token.sourceId + (token.bindingPath ?? "binding")}>
                    <p className="break-words text-[11px] font-medium text-foreground">{token.name}</p>
                    {token.bindingPath ? <p className="mt-1 break-all font-mono text-[10px] text-foreground-subtle">{token.bindingPath}</p> : null}
                    {token.value !== null ? <div className="mt-1"><TokenValue token={token} /></div> : null}
                    <p className="mt-1 text-[10px] text-foreground-subtle">{token.collectionName ?? "Uncategorized"}{token.mode ? " · " + token.mode : ""}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-foreground-subtle">No bound tokens captured. Matching raw values do not imply a token binding.</p>}
          </section>

          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-[11px] text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Source details</summary>
            <dl className="mt-2 space-y-2 text-[10px]">
              <div><dt className="text-foreground-subtle">Element ID</dt><dd className="mt-0.5 break-all font-mono text-foreground-muted">{selectedNode.sourceNodeId}</dd></div>
              <div><dt className="text-foreground-subtle">Parent element</dt><dd className="mt-0.5 break-all font-mono text-foreground-muted">{selectedNode.parentSourceNodeId ?? "None"}</dd></div>
              <div><dt className="text-foreground-subtle">Source frame</dt><dd className="mt-0.5 break-all font-mono text-foreground-muted">{selectedNode.sourceFrameId}</dd></div>
            </dl>
          </details>
        </div>
      ) : frame.kind === "overview" ? (
        <div className="mt-6 text-foreground-muted">
          <div className="flex flex-col items-center rounded-[12px] border border-dashed border-white/[0.09] px-4 py-6 text-center">
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-[10px] bg-white/[0.05] text-foreground-muted">
              <svg className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><path d="m3.5 2.5 9 4-3.8 1.4L7.3 12 3.5 2.5Z" /></svg>
            </span>
            <p className="mt-3 text-[13px] font-medium text-foreground">{inspecting ? "Select an element" : "Pick the Inspect tool"}</p>
            <p className="mt-1 max-w-[230px] text-[12px] leading-5 text-foreground-subtle">
              <span className="touch-hidden">{inspecting ? "Click anything on a screen to see its size, spacing, colors and type." : "Press I, then click anything on a screen to see its size, spacing, colors and type."}</span>
              <span className="touch-only">{inspecting ? "Tap anything on a screen to see its size, spacing, colors and type." : "Tap the arrow tool, then tap anything on a screen to see its size, spacing, colors and type."}</span>
            </p>
          </div>
          <ul className="touch-hidden mt-4 space-y-2 text-[12px]">
            <li className="flex items-center justify-between gap-3"><span>Measure distances</span><span className="flex gap-1"><kbd className="canvas-kbd">Alt</kbd><span className="text-foreground-subtle">+ hover</span></span></li>
            <li className="flex items-center justify-between gap-3"><span>Search text and colors</span><span className="flex gap-1"><kbd className="canvas-kbd">⌘</kbd><kbd className="canvas-kbd">F</kbd></span></li>
            <li className="flex items-center justify-between gap-3"><span>Next or previous screen</span><span className="flex gap-1"><kbd className="canvas-kbd">[</kbd><kbd className="canvas-kbd">]</kbd></span></li>
            <li className="flex items-center justify-between gap-3"><span>All shortcuts</span><kbd className="canvas-kbd">?</kbd></li>
          </ul>
          <dl className="mt-5 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4 text-[12px]">
            <div className="rounded-[10px] bg-white/[0.03] px-3 py-2.5"><dt className="text-[11px] text-foreground-subtle">Screens</dt><dd className="mt-0.5 font-mono text-[15px] text-foreground">{frameCount}</dd></div>
            <div className="rounded-[10px] bg-white/[0.03] px-3 py-2.5"><dt className="text-[11px] text-foreground-subtle">Elements</dt><dd className="mt-0.5 font-mono text-[15px] text-foreground">{totalNodeCount}</dd></div>
          </dl>
          {!frame.exact ? <p className="mt-4 text-[11px] leading-5 text-foreground-subtle">This image has no structured source attributes. Upload a structured Figma capture for exact measurements and token bindings.</p> : null}
        </div>
      ) : !frame.exact ? (
        <div className="mt-4 space-y-3 text-[12px] leading-5 text-foreground-muted">
          <h3 className="font-medium text-foreground">Visual-only screen</h3>
          <p>Image pixels do not include exact padding, margins, element bounds, or token bindings.</p>
        </div>
      ) : (
        <div className="mt-4">
          {/* The name gets the full width (long Figma names otherwise wrap into a narrow column). */}
          <h3 className="break-words text-[13px] font-medium leading-5 text-foreground">{frame.name}</h3>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="flex items-center gap-1.5">
              {canCompare ? <button className="dial-button min-h-8 px-2.5 text-[12px]" onClick={onCompare} type="button">Compare</button> : null}
              {onRemoveScreen ? (
                <button className={"dial-button min-h-8 px-2.5 text-[12px] " + (screenMarkedForRemoval ? "" : "!text-danger hover:!bg-danger/15")} disabled={removingScreen} onClick={onRemoveScreen} title={screenMarkedForRemoval ? "Keep this screen in the next version" : "Remove from the next version (publish to apply)"} type="button">
                  {screenMarkedForRemoval ? "Keep screen" : "Remove screen"}
                </button>
              ) : null}
            </span>
          </div>
          {canInspect ? <p className="mt-2 text-[12px] leading-5 text-foreground-subtle"><span className="touch-hidden">{inspecting ? "Click an element on this screen to inspect it." : "Press I (Inspect), then click an element on this screen."}</span><span className="touch-only">{inspecting ? "Tap an element on this screen to inspect it." : "Tap the arrow tool, then tap an element on this screen."}</span></p> : null}
          <dl className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3 text-[12px]">
            <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Size</dt><dd className="font-mono text-foreground">{formatFrameSize(frame.sourceWidth, frame.sourceHeight)}</dd></div>
            <div className="dial-row flex min-h-9 items-center justify-between gap-3 px-3"><dt className="text-foreground-subtle">Elements</dt><dd className="font-mono text-foreground">{frame.nodes.length}</dd></div>
          </dl>
          {canExport ? <div className="mt-4"><InspectorExport frame={frame} /></div> : null}
        </div>
      )}
    </div>
  );
}
