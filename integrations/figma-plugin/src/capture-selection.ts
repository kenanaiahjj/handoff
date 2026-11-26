import type { CaptureReadyMessage, LayerAssetFrameReport, LayerAssetReport } from "./types";

export function aggregateLayerAssetReport(mode: LayerAssetReport["mode"], frames: LayerAssetFrameReport[], limit = 2000): LayerAssetReport {
  const total = frames.reduce((summary, frame) => ({
    eligibleCount: summary.eligibleCount + frame.eligibleCount,
    modeSkippedCount: summary.modeSkippedCount + frame.modeSkippedCount,
    candidateCount: summary.candidateCount + frame.candidateCount,
    limitSkippedCount: summary.limitSkippedCount + frame.limitSkippedCount,
    selectedCount: summary.selectedCount + frame.selectedCount,
    exportedCount: summary.exportedCount + frame.exportedCount,
    exportFailureCount: summary.exportFailureCount + frame.exportFailureCount,
    sizeSkippedCount: summary.sizeSkippedCount + frame.sizeSkippedCount,
    fallbackCount: summary.fallbackCount + frame.fallbackCount,
  }), {
    eligibleCount: 0,
    modeSkippedCount: 0,
    candidateCount: 0,
    limitSkippedCount: 0,
    selectedCount: 0,
    exportedCount: 0,
    exportFailureCount: 0,
    sizeSkippedCount: 0,
    fallbackCount: 0,
  });
  return { mode, limit, ...total, frames };
}

export function withLayerAssetWarnings(warnings: readonly string[], report: LayerAssetReport) {
  const otherWarnings = warnings.filter((warning) =>
    !warning.includes("eligible layer assets") && !/individual layer (?:image\/vector )?export/i.test(warning),
  );
  const assetWarnings: string[] = [];
  if (report.limitSkippedCount) {
    assetWarnings.push(`Selected ${report.selectedCount} of ${report.candidateCount} matching eligible layer assets because Handoff limits individual layer exports to ${report.limit} per capture; all ${report.eligibleCount} eligible layers and their captured properties remain available in the structured snapshot.`);
  }
  if (report.fallbackCount) {
    assetWarnings.push(`${report.fallbackCount} individual layer export${report.fallbackCount === 1 ? " was" : "s were"} saved as PNG after Figma’s SVG export failed.`);
  }
  if (report.exportFailureCount) {
    assetWarnings.push(`${report.exportFailureCount} individual layer image/vector export${report.exportFailureCount === 1 ? " could not be" : "s could not be"} generated. Their frame renders and structured layer data were retained.`);
  }
  if (report.sizeSkippedCount) {
    assetWarnings.push(`${report.sizeSkippedCount} individual layer image/vector export${report.sizeSkippedCount === 1 ? " exceeded" : "s exceeded"} the per-asset or capture transfer limits. Their frame renders and structured layer data were retained.`);
  }
  return [...otherWarnings, ...assetWarnings];
}

export function filterCaptureToFrameIds(capture: CaptureReadyMessage, includedFrameIds: ReadonlySet<string>): CaptureReadyMessage {
  const frames = capture.payload.frames.filter((frame) => includedFrameIds.has(frame.sourceFrameId));
  const renderKeys = new Set(frames.map((frame) => frame.renderAssetKey));
  const vectorAssetKeys = new Set(frames.flatMap((frame) => frame.vectorAssetKey ? [frame.vectorAssetKey] : []));
  const renders = capture.renders.filter((render) => renderKeys.has(render.key));
  const vectorRenders = capture.vectorRenders.filter((render) => vectorAssetKeys.has(render.key));
  const layerRenders = capture.layerRenders.filter((render) => includedFrameIds.has(render.sourceFrameId));
  const frameIds = new Set(frames.map((frame) => frame.sourceFrameId));
  const layerAssetReport = aggregateLayerAssetReport(
    capture.layerAssetReport.mode,
    capture.layerAssetReport.frames.filter((frame) => frameIds.has(frame.sourceFrameId)),
    capture.layerAssetReport.limit,
  );
  const warnings = withLayerAssetWarnings(capture.warnings, layerAssetReport);
  const sourceMetadata: CaptureReadyMessage["payload"]["sourceMetadata"] = {
    ...capture.payload.sourceMetadata,
    vectorSourcePreserved: frames.length > 0 && vectorRenders.length === frames.length,
    vectorSourceFrameCount: vectorRenders.length,
    layerExportAssetCount: layerRenders.length,
    layerExportSkippedCount: layerAssetReport.limitSkippedCount + layerAssetReport.exportFailureCount + layerAssetReport.sizeSkippedCount,
    layerExportFallbackCount: layerAssetReport.fallbackCount,
    renderScaleFallbackFrameIds: Array.isArray(capture.payload.sourceMetadata.renderScaleFallbackFrameIds)
      ? capture.payload.sourceMetadata.renderScaleFallbackFrameIds.filter((frameId): frameId is string => typeof frameId === "string" && frameIds.has(frameId))
      : [],
    captureWarnings: warnings,
  };
  // Screens unticked in a section stay as they were in Handoff: a section capture only removes
  // screens that are no longer in the section in Figma.
  if (Array.isArray(capture.payload.sourceMetadata.sections)) {
    sourceMetadata.sections = capture.payload.sourceMetadata.sections.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const frameIdList = Array.isArray(entry.frameIds) ? entry.frameIds.filter((id): id is string => typeof id === "string") : [];
      const skippedFrameIds = frameIdList.filter((id) => !frameIds.has(id));
      return {
        ...entry,
        frameIds: frameIdList.filter((id) => frameIds.has(id)),
        ...(skippedFrameIds.length ? { skippedFrameIds } : {}),
      };
    });
  }

  return {
    ...capture,
    payload: { ...capture.payload, frames, sourceMetadata },
    renders,
    vectorRenders,
    layerRenders,
    warnings,
    layerAssetReport,
  };
}
