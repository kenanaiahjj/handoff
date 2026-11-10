"use client";

import { useState } from "react";
import type { SnapshotNode } from "@asbir/snapshot-contract";
import type { HandoffComment } from "../comments/CommentPin";
import type { CanvasFrameOption } from "./FrameNavigator";
import { MeasurementRow } from "./MeasurementRow";
import { formatFrameSize, formatPixelValue, inspectionMargins } from "./format-captured-measurement";
import { capturedGridTracks, formatGridTrack, shouldShowGridLayout } from "./grid-layout";
import { readPaintDetails, readTextStyleRuns, type TextStyleRun } from "./text-style-runs";

type ElementInspectorProps = {
  frame: CanvasFrameOption;
  selectedNode: SnapshotNode | null;
  frameCount: number;
  totalNodeCount: number;
  comments: HandoffComment[];
  canComment: boolean;
  canCompare: boolean;
  onCompare: () => void;
  onAddComment: () => void;
  onSelectNode: (sourceNodeId: string) => void;
  onCopyLink: () => void | Promise<void>;
};

function valueText(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function measurementText(value: unknown) {
  return typeof value === "number" ? formatPixelValue(value) : valueText(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cornerRadiusLimit(width: number | null, height: number | null) {
  if (width === null || height === null || width < 0 || height < 0) return null;
  return Math.min(width, height) / 2;
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
}: {
  title: string;
  values: Record<string, { value: number | null; unit: string; provenance: "source" | "measured" | "unavailable"; sourceProperty: string | null }>;
}) {
  const available = Object.entries(values).filter(([, measurement]) =>
    measurement.value !== null && measurement.provenance !== "unavailable",
  );
  if (!available.length) return null;

  return (
    <section className="border-t border-[#393939] pt-3">
      <h3 className="mb-1 text-[12px] font-semibold text-[#c8c8c8]">{title}</h3>
      <dl>
        {available.map(([label, measurement]) => (
          <MeasurementRow key={label} label={label} measurement={measurement} />
        ))}
      </dl>
    </section>
  );
}

function cssForNode(node: SnapshotNode) {
  const declarations: string[] = [];
  const addMeasurement = (name: string, value: number | null, unit: string) => {
    if (value !== null) declarations.push(name + ": " + formatPixelValue(value) + unit + ";");
  };
  addMeasurement("width", node.bounds.width.value, "px");
  addMeasurement("height", node.bounds.height.value, "px");
  if (node.layout.mode) declarations.push("display: " + (/auto.?layout|flex/i.test(node.layout.mode) ? "flex" : node.layout.mode.toLowerCase()) + ";");
  if (node.layout.direction) declarations.push("flex-direction: " + node.layout.direction.toLowerCase() + ";");
  if ([node.padding.top.value, node.padding.right.value, node.padding.bottom.value, node.padding.left.value].every((value) => value !== null)) {
    declarations.push("padding: " + [node.padding.top, node.padding.right, node.padding.bottom, node.padding.left].map((item) => formatPixelValue(item.value!) + item.unit).join(" ") + ";");
  }
  const uniformRadius = finiteNumber(node.sourcePayload.cornerRadius);
  const radiusValues = [
    finiteNumber(node.sourcePayload.topLeftRadius) ?? uniformRadius,
    finiteNumber(node.sourcePayload.topRightRadius) ?? uniformRadius,
    finiteNumber(node.sourcePayload.bottomRightRadius) ?? uniformRadius,
    finiteNumber(node.sourcePayload.bottomLeftRadius) ?? uniformRadius,
  ];
  if (radiusValues.every((value) => value !== null)) {
    const limit = cornerRadiusLimit(node.bounds.width.value, node.bounds.height.value);
    const effectiveValues = radiusValues.map((value) => formatPixelValue(limit === null ? value! : Math.min(value!, limit)) + "px");
    declarations.push("border-radius: " + effectiveValues.join(" ") + ";");
  }
  const gap = node.spacing.itemGap.value ?? node.spacing.rowGap.value ?? node.spacing.columnGap.value;
  addMeasurement("gap", gap, "px");
  const fill = node.fills.find((paint) => paint.color)?.color;
  if (fill) declarations.push("background-color: " + fill + ";");
  if (node.typography?.fontFamily) declarations.push("font-family: " + JSON.stringify(node.typography.fontFamily) + ";");
  addMeasurement("font-size", node.typography?.fontSize.value ?? null, "px");
  if (node.typography?.fontWeight !== null && node.typography?.fontWeight !== undefined) declarations.push("font-weight: " + node.typography.fontWeight + ";");
  return declarations.join("\n");
}

function CopyValue({ label, value, displayValue = value, className }: { label: string; value: string; displayValue?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={"Copy " + label}
      className={className ?? "block min-w-0 max-w-full whitespace-normal break-all text-left font-mono text-[11px] text-[#e1e1e1] [overflow-wrap:anywhere] hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
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
      {color ? <span aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border border-white/20" style={{ backgroundColor: color.swatch }} /> : null}
      <div className="min-w-0 flex-1"><CopyValue label={token.name} value={color?.text ?? valueText(token.value)} /></div>
    </div>
  );
}

function TextStyleRuns({ runs }: { runs: TextStyleRun[] }) {
  if (!runs.length) return null;

  return (
    <details className="mt-3 border-t border-[#393939] pt-3">
      <summary className="cursor-pointer text-[11px] text-[#c8c8c8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">
        Text styles <span className="text-[#8e8e8e]">· {runs.length} {runs.length === 1 ? "run" : "runs"}</span>
      </summary>
      <div className="mt-2 space-y-1.5">
        {runs.map((run, index) => {
          const excerpt = run.characters.replace(/\s+/g, " ").trim() || "Empty text run";
          const properties = availableProperties([
            { label: "Font", value: [run.fontFamily, run.fontStyle].filter(Boolean).join(" · ") },
            { label: "Size", value: run.fontSize === null ? null : formatPixelValue(run.fontSize) + "px" },
            { label: "Weight", value: run.fontWeight },
            { label: "Line height", value: measurementText(run.lineHeight) },
            { label: "Letter spacing", value: measurementText(run.letterSpacing) },
          ]);
          return (
            <details className="rounded-[5px] bg-[#181818] px-2.5 py-2" key={`${run.start}:${run.end}`}>
              <summary className="flex cursor-pointer items-center justify-between gap-2 text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">
                <span className="min-w-0 truncate text-[#d5d5d5]" title={run.characters}>{excerpt}</span>
                <span className="shrink-0 font-mono text-[#999]">{run.fontSize === null ? `Run ${index + 1}` : `${formatPixelValue(run.fontSize)}px`}</span>
              </summary>
              {properties.length ? (
                <dl className="mt-2 space-y-1.5 text-[10px]">
                  {properties.map((property) => (
                    <div className="flex justify-between gap-3" key={property.label}>
                      <dt className="text-[#888]">{property.label}</dt>
                      <dd className={property.label === "Size" || property.label === "Line height" || property.label === "Letter spacing" ? "font-mono break-words text-right text-[#ccc]" : "break-words text-right text-[#ccc]"}>
                        {property.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {run.fills.length ? (
                <div className="mt-2 space-y-1.5">
                  {run.fills.map((fill, fillIndex) => (
                    <div className="rounded-[4px] border border-[#303030] px-2 py-1.5" key={`${fill.type}:${fillIndex}`}>
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-[#888]">Text fill · {fill.type.toLowerCase()}</span>
                        {fill.opacity !== null ? <span className="font-mono text-[#999]">{Math.round(fill.opacity * 100)}%</span> : null}
                      </div>
                      {fill.color ? (
                        <div className="mt-1 flex items-center gap-2">
                          <span aria-hidden="true" className="size-3.5 shrink-0 rounded-[3px] border border-[#555]" style={{ backgroundColor: fill.color }} />
                          <CopyValue label={`Text fill ${fillIndex + 1}`} value={fill.color} />
                        </div>
                      ) : null}
                      {fill.gradientStops.length ? (
                        <ul className="mt-1 space-y-1">
                          {fill.gradientStops.map((stop, stopIndex) => (
                            <li className="flex items-center justify-between gap-2" key={stopIndex}>
                              <span className="flex min-w-0 items-center gap-2">
                                {stop.color ? <span aria-hidden="true" className="size-3.5 shrink-0 rounded-[3px] border border-[#555]" style={{ backgroundColor: stop.color }} /> : null}
                                <span className="text-[#999]">Stop {stopIndex + 1}{stop.position === null ? "" : ` · ${Math.round(stop.position * 100)}%`}{stop.opacity === null ? "" : ` · ${Math.round(stop.opacity * 100)}%`}</span>
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
                <ul className="mt-2 space-y-1.5 border-t border-[#303030] pt-2">
                  {run.tokens.map((token) => (
                    <li key={token.sourceId + (token.bindingPath ?? "binding")}>
                      <p className="text-[10px] font-medium text-[#cfcfcf]">{token.name}</p>
                      {token.bindingPath ? <p className="mt-0.5 break-all font-mono text-[9px] text-[#888]">{token.bindingPath}</p> : null}
                      <div className="mt-0.5"><CopyValue label={token.name} value={valueText(token.value)} /></div>
                      <p className="mt-0.5 text-[9px] text-[#888]">{token.collectionName ?? "Uncategorized"}{token.mode ? ` · ${token.mode}` : ""}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {run.textStyleId || run.fillStyleId ? (
                <p className="mt-2 break-all border-t border-[#303030] pt-1.5 font-mono text-[9px] text-[#999]">
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
  onCompare,
  onAddComment,
  onSelectNode,
  onCopyLink,
}: ElementInspectorProps) {
  const [cssCopied, setCssCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
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
    const appearancePaints = selectedNode
      ? [
          ...nodePaintDetails(selectedNode, "fillPaintDetails", selectedNode.fills).map((paint, index) => ({ ...paint, label: `Fill ${index + 1}` })),
          ...nodePaintDetails(selectedNode, "strokePaintDetails", selectedNode.strokes).map((paint, index) => ({ ...paint, label: `Stroke ${index + 1}` })),
        ]
      : [];
  const selectedWidth = selectedNode?.bounds.width.value ?? null;
  const selectedHeight = selectedNode?.bounds.height.value ?? null;
  const layerExport = selectedNode ? frame.layerExports?.[selectedNode.sourceNodeId] ?? null : null;
  const aspectRatio = selectedWidth !== null && selectedHeight !== null && selectedHeight > 0
    ? Number((selectedWidth / selectedHeight).toFixed(2)) + ":1"
    : null;
  const uniformRadius = finiteNumber(selectedNode?.sourcePayload.cornerRadius);
  const isGridContainer = selectedNode ? shouldShowGridLayout({
    mode: selectedNode.layout.mode,
    gridColumnCount: selectedNode.layout.constraints.gridColumnCount,
    gridRowCount: selectedNode.layout.constraints.gridRowCount,
    gridColumnSizes: selectedNode.sourcePayload.gridColumnSizes,
    gridRowSizes: selectedNode.sourcePayload.gridRowSizes,
  }) : false;
  const gridParentNode = selectedNode?.parentSourceNodeId
    ? frame.nodes.find((node) => node.sourceNodeId === selectedNode.parentSourceNodeId) ?? null
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
  const radiusLimit = cornerRadiusLimit(selectedWidth, selectedHeight);
  const hasCornerRadius = radiusDisplayFields.length > 0;

  async function copyCss() {
    if (!selectedNode) return;
    try {
      await navigator.clipboard.writeText(cssForNode(selectedNode));
      setCssCopied(true);
      window.setTimeout(() => setCssCopied(false), 1200);
    } catch {
      setCssCopied(false);
    }
  }

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
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#202020] px-4 py-4 text-[#c5c5c5]">
      <h2 className="text-[14px] font-semibold text-[#ededed]">Properties</h2>

      {selectedNode ? (
        <div className="mt-4">
          <div className="mb-4 min-w-0">
            <p className="break-words text-[13px] font-semibold text-[#ededed]">{selectedNode.name || "Unnamed element"}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#999]">
              <span className="rounded-[4px] bg-[#333] px-1.5 py-0.5 font-mono">{selectedNode.type}</span>
              <span>{selectedNode.visible ? "Visible" : "Hidden"}</span>
            </div>
            <p className="mt-2 break-all font-mono text-[10px] text-[#8b8b8b]">{selectedNode.sourceNodeId}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              <button className="min-h-7 rounded-[4px] px-2 text-[10px] text-[#c3c3c3] hover:bg-[#343434] hover:text-white" onClick={copyCss} type="button">{cssCopied ? "Copied CSS" : "Copy CSS"}</button>
              <button className="min-h-7 rounded-[4px] px-2 text-[10px] text-[#c3c3c3] hover:bg-[#343434] hover:text-white" onClick={copyLink} type="button">{linkCopied ? "Copied link" : "Copy link"}</button>
              {selectedNode.parentSourceNodeId ? (
                <button className="min-h-7 rounded-[4px] px-2 text-[10px] text-[#c3c3c3] hover:bg-[#343434] hover:text-white" onClick={() => onSelectNode(selectedNode.parentSourceNodeId!)} type="button">Parent</button>
              ) : null}
              {layerExport ? (
                <a
                  aria-label={`Export ${selectedNode.name || "selected layer"} as ${layerExport.contentType === "image/svg+xml" ? "SVG" : "PNG"}`}
                  className="inline-flex min-h-7 items-center rounded-[4px] bg-[#3a3020] px-2 text-[10px] font-medium text-[#f0c77b] hover:bg-[#514127] hover:text-[#ffe0a4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0c77b]"
                  download={layerExport.fileName}
                  href={layerExport.downloadUrl}
                  title={`Download ${layerExport.fileName}`}
                >
                  Export {layerExport.contentType === "image/svg+xml" ? "SVG" : "PNG"}
                </a>
              ) : null}
              {canCompare ? <button className="min-h-7 rounded-[4px] px-2 text-[10px] text-[#c3c3c3] hover:bg-[#343434] hover:text-white" onClick={onCompare} type="button">Compare</button> : null}
            </div>
          </div>

          <section className="border-t border-[#393939] py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold text-[#c8c8c8]">Comments on this element</h3>
              <span className="font-mono text-[10px] text-[#8e8e8e]">{comments.length}</span>
            </div>
            {comments.slice(0, 3).map((comment) => (
              <p className="mb-2 text-[11px] leading-5 text-[#aaa]" key={comment.id}><span className="font-medium text-[#d4d4d4]">{comment.authorName}</span> · {comment.body}</p>
            ))}
            {canComment ? <button className="min-h-8 rounded-[5px] bg-[#353535] px-2.5 text-[11px] text-[#e5e5e5] hover:bg-[#414141]" onClick={onAddComment} type="button">Comment</button> : null}
          </section>

          <MeasurementGroup title="Layout" values={selectedNode.bounds} />
          <section className="border-t border-[#393939] pt-3">
            <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Size and shape</h3>
            <dl className="space-y-2 text-[11px]">
              <div className="flex justify-between gap-3"><dt className="text-[#999]">Aspect ratio</dt><dd className="font-mono text-right text-[#ddd]">{aspectRatio ?? "Unavailable"}</dd></div>
              {hasCornerRadius ? (
                <>
                  {radiusDisplayFields.map(({ label, value }) => {
                    const effectiveValue = radiusLimit === null ? value : Math.min(value, radiusLimit);
                    const isClamped = effectiveValue < value;
                    return (
                      <div className="grid grid-cols-[1fr_auto] items-start gap-x-3" key={label}>
                        <dt className="text-[#999]">{label}</dt>
                        <dd className="text-right"><CopyValue label={`${label.toLowerCase()} radius`} value={`${formatPixelValue(effectiveValue)}px`} /></dd>
                        {isClamped ? (
                          <dd className="col-span-2 mt-1 text-right text-[10px] text-[#888]">
                            Figma source: {" "}
                            <CopyValue
                              className="inline-block max-w-full break-all font-mono text-[10px] text-[#aaa] hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
                              displayValue={`${value.toLocaleString("en-US", { maximumSignificantDigits: 21 })}px`}
                              label={`${label.toLowerCase()} radius source value`}
                              value={`${String(value)}px`}
                            />
                            {" · clamped to fit"}
                          </dd>
                        ) : null}
                      </div>
                    );
                  })}
                </>
              ) : <div className="flex justify-between gap-3"><dt className="text-[#999]">Corner radius</dt><dd className="text-right text-[#999]">Unavailable</dd></div>}
              {finiteNumber(selectedNode.sourcePayload.rotation) !== null ? <div className="flex justify-between gap-3"><dt className="text-[#999]">Rotation</dt><dd className="font-mono text-right text-[#ddd]">{formatPixelValue(finiteNumber(selectedNode.sourcePayload.rotation)!)}°</dd></div> : null}
              {finiteNumber(selectedNode.sourcePayload.opacity) !== null ? <div className="flex justify-between gap-3"><dt className="text-[#999]">Opacity</dt><dd className="font-mono text-right text-[#ddd]">{Math.round(finiteNumber(selectedNode.sourcePayload.opacity)! * 100)}%</dd></div> : null}
            </dl>
            <p className="mt-2 text-[10px] leading-4 text-[#888]">The aspect ratio is calculated from the captured source bounds.</p>
          </section>
          <MeasurementGroup title="Padding" values={selectedNode.padding} />
          <MeasurementGroup title="Measured margins" values={inspectionMargins(selectedNode)} />
          <MeasurementGroup title="Spacing" values={selectedNode.spacing} />

          <section className="border-t border-[#393939] pt-3">
            <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Layout properties</h3>
            <dl className="space-y-2 text-[11px]">
              <div className="flex justify-between gap-3"><dt className="text-[#999]">Mode</dt><dd className="text-right text-[#ddd]">{selectedNode.layout.mode ?? "Unavailable"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#999]">Direction</dt><dd className="text-right text-[#ddd]">{selectedNode.layout.direction ?? "Unavailable"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#999]">Primary alignment</dt><dd className="text-right text-[#ddd]">{selectedNode.layout.primaryAxisAlign ?? "Unavailable"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#999]">Counter alignment</dt><dd className="text-right text-[#ddd]">{selectedNode.layout.counterAxisAlign ?? "Unavailable"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#999]">Wrap</dt><dd className="text-right text-[#ddd]">{selectedNode.layout.wrap === null ? "Unavailable" : selectedNode.layout.wrap ? "Enabled" : "Disabled"}</dd></div>
            </dl>
          </section>

          {isGridContainer ? (
            <section className="border-t border-[#393939] pt-3">
              <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Grid layout</h3>
              <dl className="space-y-2 text-[11px]">
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Columns</dt><dd className="text-right text-[#ddd]">{valueText(selectedNode.layout.constraints.gridColumnCount)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Rows</dt><dd className="text-right text-[#ddd]">{valueText(selectedNode.layout.constraints.gridRowCount)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Column gap</dt><dd className="text-right text-[#ddd]">{measurementText(selectedNode.spacing.columnGap.value)} {selectedNode.spacing.columnGap.unit}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Row gap</dt><dd className="text-right text-[#ddd]">{measurementText(selectedNode.spacing.rowGap.value)} {selectedNode.spacing.rowGap.unit}</dd></div>
                {selectedNode.sourcePayload.gridAutoTracks !== undefined ? <div className="flex justify-between gap-3"><dt className="text-[#999]">Automatic rows</dt><dd className="text-right text-[#ddd]">{valueText(selectedNode.sourcePayload.gridAutoTracks)}</dd></div> : null}
                {selectedNode.sourcePayload.gridItemsPositioning !== undefined ? <div className="flex justify-between gap-3"><dt className="text-[#999]">Item placement</dt><dd className="text-right text-[#ddd]">{valueText(selectedNode.sourcePayload.gridItemsPositioning)}</dd></div> : null}
              </dl>
              {gridColumnTracks.length ? <p className="mt-2 break-words text-[10px] leading-4 text-[#929292]">Column tracks: {gridColumnTracks.map((track, index) => `${index + 1}. ${formatGridTrack(track)}`).join(" · ")}</p> : null}
              {gridRowTracks.length ? <p className="mt-1 break-words text-[10px] leading-4 text-[#929292]">Row tracks: {gridRowTracks.map((track, index) => `${index + 1}. ${formatGridTrack(track)}`).join(" · ")}</p> : null}
            </section>
          ) : null}

          {isGridItem ? (
            <section className="border-t border-[#393939] pt-3">
              <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Grid item</h3>
              <dl className="space-y-2 text-[11px]">
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Cell</dt><dd className="text-right text-[#ddd]">{[
                  gridRowIndex === null ? null : `Row ${Math.trunc(gridRowIndex) + 1}`,
                  gridColumnIndex === null ? null : `Column ${Math.trunc(gridColumnIndex) + 1}`,
                ].filter(Boolean).join(" · ") || "Unavailable"}</dd></div>
                {availableProperties([
                  { label: "Row span", value: selectedNode.sourcePayload.gridRowSpan },
                  { label: "Column span", value: selectedNode.sourcePayload.gridColumnSpan },
                  { label: "Horizontal alignment", value: selectedNode.sourcePayload.gridChildHorizontalAlign },
                  { label: "Vertical alignment", value: selectedNode.sourcePayload.gridChildVerticalAlign },
                ]).map((property) => (
                  <div className="flex justify-between gap-3" key={property.label}><dt className="text-[#999]">{property.label}</dt><dd className="text-right text-[#ddd]">{property.value}</dd></div>
                ))}
              </dl>
            </section>
          ) : null}

          {capturedLayoutGrids(selectedNode).length ? (
            <section className="border-t border-[#393939] pt-3">
              <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Canvas grids</h3>
              <ul className="space-y-2">
                {capturedLayoutGrids(selectedNode).map((grid, index) => (
                  <li className="rounded-[5px] bg-[#181818] p-2.5 text-[10px]" key={`${String(grid.pattern ?? "grid")}-${index}`}>
                    <p className="font-medium text-[#dedede]">{String(grid.pattern ?? "Grid").toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}{typeof grid.visible === "boolean" && !grid.visible ? " · hidden" : ""}</p>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[#999]">
                      {(["count", "sectionSize", "gutterSize", "offset", "alignment"] as const).map((key) => grid[key] === undefined ? null : (
                        <div className="contents" key={key}><dt>{key === "sectionSize" ? "Size" : key === "gutterSize" ? "Gutter" : key === "alignment" ? "Alignment" : key === "offset" ? "Offset" : "Count"}</dt><dd className="truncate text-right text-[#d0d0d0]">{measurementText(grid[key])}{["sectionSize", "gutterSize", "offset"].includes(key) && typeof grid[key] === "number" ? " px" : ""}</dd></div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="border-t border-[#393939] pt-3">
            <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Appearance</h3>
            {appearancePaints.length ? (
              <div className="space-y-1.5">
                {appearancePaints.map((paint, index) => (
                  <div className="rounded-[5px] bg-[#181818] px-2.5 py-2" key={paint.label + index}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[11px] text-[#aaa]">
                        <span aria-hidden="true" className="size-4 shrink-0 rounded-[3px] border border-[#474747]" style={{ backgroundColor: paint.color ?? "transparent", opacity: paint.opacity ?? 1 }} />
                        <span className="truncate">{paint.label} · {paintTypeLabel(paint.type)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-[#999]">{percentText(paint.opacity)}</span>
                    </div>
                    {paint.color ? (
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px]">
                        <span className="text-[#888]">Color</span>
                        <CopyValue label={`${paint.label} color`} value={paint.color} />
                      </div>
                    ) : null}
                    {paint.gradientStops.length ? (
                      <ul className="mt-1.5 space-y-1 border-t border-[#303030] pt-1.5">
                        {paint.gradientStops.map((stop, stopIndex) => (
                          <li className="flex items-center justify-between gap-2" key={stopIndex}>
                            <span className="flex min-w-0 items-center gap-2">
                              {stop.color ? <span aria-hidden="true" className="size-3.5 shrink-0 rounded-[3px] border border-[#555]" style={{ backgroundColor: stop.color, opacity: stop.opacity ?? 1 }} /> : null}
                              <span className="truncate text-[10px] text-[#999]">Stop {stopIndex + 1}{stop.position === null ? "" : ` · ${percentText(stop.position)}`}{stop.opacity === null ? "" : ` · ${percentText(stop.opacity)} opacity`}</span>
                            </span>
                            {stop.color ? <CopyValue label={`${paint.label} gradient stop ${stopIndex + 1}`} value={stop.color} /> : <span className="text-[10px] text-[#999]">Color unavailable</span>}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {!paint.color && !paint.gradientStops.length ? <p className="mt-1.5 text-[10px] text-[#888]">No color value for this paint type.</p> : null}
                  </div>
                ))}
              </div>
            ) : <p className="text-[11px] text-[#929292]">No fills or strokes captured.</p>}
            {selectedNode.styleReferences.length ? (
              <ul className="mt-2 space-y-1">
                {selectedNode.styleReferences.map((style) => <li className="text-[11px] text-[#aaa]" key={style.kind + style.sourceStyleId}>{style.kind}: {style.name ?? style.sourceStyleId}</li>)}
              </ul>
            ) : null}
          </section>

          <section className="border-t border-[#393939] pt-3">
            <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Typography</h3>
            {selectedNode.typography ? (
              <dl className="space-y-2 text-[11px]">
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Font</dt><dd className="max-w-40 truncate text-right text-[#ddd]">{selectedNode.typography.fontFamily ?? (textStyleRuns.length > 1 ? "Mixed — see text styles" : "Unavailable")}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Size</dt><dd className="text-right text-[#ddd]">{selectedNode.typography.fontSize.value === null && textStyleRuns.length > 1 ? "Mixed — see text styles" : `${measurementText(selectedNode.typography.fontSize.value)} ${selectedNode.typography.fontSize.unit}`}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Weight</dt><dd className="text-right text-[#ddd]">{selectedNode.typography.fontWeight ?? (textStyleRuns.length > 1 ? "Mixed — see text styles" : "Unavailable")}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Line height</dt><dd className="text-right text-[#ddd]">{selectedNode.typography.lineHeight.value === null && textStyleRuns.length > 1 ? "Mixed — see text styles" : `${measurementText(selectedNode.typography.lineHeight.value)} ${selectedNode.typography.lineHeight.unit}`}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Letter spacing</dt><dd className="text-right text-[#ddd]">{selectedNode.typography.letterSpacing.value === null && textStyleRuns.length > 1 ? "Mixed — see text styles" : `${measurementText(selectedNode.typography.letterSpacing.value)} ${selectedNode.typography.letterSpacing.unit}`}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#999]">Alignment</dt><dd className="text-right text-[#ddd]">{selectedNode.typography.textAlign ?? "Unavailable"}</dd></div>
                {selectedNode.typography.content !== null ? <div className="border-t border-[#393939] pt-2"><dt className="text-[#999]">Text content</dt><dd className="mt-1 break-words text-[#ddd]">{selectedNode.typography.content}</dd></div> : null}
              </dl>
            ) : textStyleRuns.length ? <p className="text-[11px] text-[#929292]">Typography is captured per text run.</p> : <p className="text-[11px] text-[#929292]">No typography data captured.</p>}
            <TextStyleRuns runs={textStyleRuns} />
          </section>

          <section className="border-t border-[#393939] pt-3">
            <h3 className="mb-2 text-[12px] font-semibold text-[#c8c8c8]">Bound tokens</h3>
            {selectedNode.tokens.length ? (
              <ul className="space-y-2">
                {selectedNode.tokens.map((token) => (
                  <li className="rounded-[5px] bg-[#181818] p-2.5" key={token.sourceId + (token.bindingPath ?? "binding")}>
                    <p className="break-words text-[11px] font-medium text-[#e2e2e2]">{token.name}</p>
                    {token.bindingPath ? <p className="mt-1 break-all font-mono text-[10px] text-[#8e8e8e]">{token.bindingPath}</p> : null}
                    {token.value !== null ? <div className="mt-1"><TokenValue token={token} /></div> : null}
                    <p className="mt-1 text-[10px] text-[#888]">{token.collectionName ?? "Uncategorized"}{token.mode ? " · " + token.mode : ""}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-[#929292]">No bound tokens captured. Matching raw values do not imply a token binding.</p>}
          </section>

          <details className="border-t border-[#393939] pt-3">
            <summary className="cursor-pointer text-[11px] text-[#a4a4a4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Source details</summary>
            <dl className="mt-2 space-y-2 text-[10px]">
              <div><dt className="text-[#888]">Parent element</dt><dd className="mt-0.5 break-all font-mono text-[#aaa]">{selectedNode.parentSourceNodeId ?? "None"}</dd></div>
              <div><dt className="text-[#888]">Source frame</dt><dd className="mt-0.5 break-all font-mono text-[#aaa]">{selectedNode.sourceFrameId}</dd></div>
            </dl>
          </details>
        </div>
      ) : frame.kind === "overview" ? (
        <div className="mt-5 space-y-5 text-[13px] leading-6 text-[#a0a0a0]">
          <p>
            Switch to Inspect in the top bar, then select a design element to see its size, spacing, colours and type. View keeps layer hit areas out of the way. Hold <kbd className="rounded-[4px] bg-[#333] px-1.5 py-0.5 font-mono text-[11px] text-[#ddd]">Alt</kbd> and point at another element for the distance between them. Click a value to copy it.
          </p>
          <p><kbd className="rounded-[4px] bg-[#333] px-1.5 py-0.5 font-mono text-[11px] text-[#ddd]">⌘ F</kbd> searches text, colours and elements on every screen.</p>
          <dl className="space-y-2 border-t border-[#393939] pt-3 text-[11px]">
            <div className="flex justify-between gap-3"><dt className="text-[#969696]">Screens</dt><dd className="font-mono text-[#ddd]">{frameCount}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#969696]">Captured elements</dt><dd className="font-mono text-[#ddd]">{totalNodeCount}</dd></div>
          </dl>
          {!frame.exact ? <p className="text-[11px] leading-5 text-[#888]">This image has no structured source attributes. Upload a structured Figma capture for exact measurements and token bindings.</p> : null}
        </div>
      ) : !frame.exact ? (
        <div className="mt-4 space-y-3 text-[12px] leading-5 text-[#a0a0a0]">
          <h3 className="font-medium text-[#e0e0e0]">Visual-only screen</h3>
          <p>Image pixels do not include exact padding, margins, element bounds, or token bindings.</p>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="break-words text-[13px] font-medium text-[#e5e5e5]">{frame.name}</h3>
            {canCompare ? <button className="min-h-8 rounded-[5px] px-2.5 text-[11px] text-[#c7c7c7] hover:bg-[#343434] hover:text-white" onClick={onCompare} type="button">Compare</button> : null}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[#999]">Switch to Inspect in the top bar, then select an element to inspect its captured attributes.</p>
          <dl className="mt-4 space-y-2 border-t border-[#393939] pt-3 text-[11px]">
            <div className="flex justify-between gap-3"><dt className="text-[#969696]">Size</dt><dd className="font-mono text-[#ddd]">{formatFrameSize(frame.sourceWidth, frame.sourceHeight)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#969696]">Elements</dt><dd className="font-mono text-[#ddd]">{frame.nodes.length}</dd></div>
          </dl>
          <p className="mt-4 border-t border-[#393939] pt-3 text-[10px] leading-4 text-[#888]">Measurements retain source or measured provenance.</p>
        </div>
      )}
    </div>
  );
}
