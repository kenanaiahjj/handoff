import { isPluginOutdated, pluginVersionUrl } from "./plugin-version";
import { retainPendingUploadForToken } from "./pending-upload.ts";
import {
  createSnapshotEnvelope,
  MAX_CAPTURE_ASSET_BYTES,
  sha256Hex,
  type SnapshotAsset,
  type SnapshotEnvelope,
  type SnapshotFrame,
  type SnapshotPayload,
  createFigmaCaptureMergePlan,
  getFigmaCaptureOverviewClearRects,
  getFigmaCaptureOverviewKeepRects,
  MAX_SNAPSHOT_JSON_BYTES,
  type PageCaptureChoice,
  type PageCaptureMode,
} from "@asbir/snapshot-contract";
import { jsonByteLength } from "./json-byte-length.ts";
import { sendFinalizeWithRetry, withNetworkDiagnostics } from "./network-errors";
import { encodeUtf8 } from "../../../packages/snapshot-contract/src/utf8";
import type {
  CaptureAssetBytes,
  CaptureErrorMessage,
  CaptureProgressMessage,
  CaptureReadyMessage,
  LayerAssetMode,
} from "./types";
import { filterCaptureToFrameIds } from "./capture-selection";
import { isRejectedSvgAssetResponse, makeRasterOnlyFallback } from "./raster-fallback";
import { frameRenderCrop } from "./render-crop";
import { availableOverviewBudget } from "./transfer-budget";
import { countBlankFrameNames, findDuplicateFrameNames } from "./frame-names";
import { captureSectionRecords, formatFigmaCaptureScope } from "@asbir/snapshot-contract";
import { requireExactOrigin } from "./network-access.mjs";
import {
  buildFinalizeManifest,
  createUploadSessionState,
  gzipSnapshotBytes,
  requestCaptureUploadIntent,
  SNAPSHOT_GZIP_CONTENT_TYPE,
  SNAPSHOT_JSON_CONTENT_TYPE,
  renewCaptureSession,
  uploadCaptureAssets,
  type CaptureUploadIntent,
  type RenderUploadAsset,
  type SnapshotUploadAsset,
  type UploadSessionState,
} from "./storage-upload";

declare const __ASBIR_HANDOFF_ORIGIN__: string;
declare const __ASBIR_STORAGE_ORIGIN__: string;
declare const __ASBIR_PLUGIN_BUILD__: string;

// Name the unreachable address instead of a bare "Failed to fetch", and retry safe requests once.
globalThis.fetch = withNetworkDiagnostics(globalThis.fetch.bind(globalThis));

const appUrlInput = document.querySelector<HTMLInputElement>("#app-url")!;
const tokenInput = document.querySelector<HTMLInputElement>("#capture-token")!;
const scopeInput = document.querySelector<HTMLSelectElement>("#capture-scope")!;
const pageExclusions = document.querySelector<HTMLElement>("#page-exclusions")!;
const scopeHelp = document.querySelector<HTMLElement>("#scope-help")!;
const excludedSectionsInput = document.querySelector<HTMLInputElement>("#excluded-sections")!;
const layerAssetModeInput = document.querySelector<HTMLSelectElement>("#layer-asset-mode")!;
const captureButton = document.querySelector<HTMLButtonElement>("#capture-button")!;
const uploadButton = document.querySelector<HTMLButtonElement>("#upload-button")!;
const uploadProgress = document.querySelector<HTMLProgressElement>("#upload-progress")!;
const cancelUploadButton = document.querySelector<HTMLButtonElement>("#cancel-upload-button")!;
const status = document.querySelector<HTMLElement>("#status")!;
const preview = document.querySelector<HTMLCanvasElement>("#canvas-preview")!;
const summary = document.querySelector<HTMLElement>("#capture-summary")!;
const frameManifest = document.querySelector<HTMLElement>("#frame-manifest")!;
const frameManifestSummary = document.querySelector<HTMLElement>("#frame-manifest-summary")!;
const frameManifestIntro = document.querySelector<HTMLElement>("#frame-manifest-intro")!;
const frameList = document.querySelector<HTMLUListElement>("#frame-list")!;
const frameListFieldset = document.querySelector<HTMLFieldSetElement>("#frame-list-fieldset")!;
const frameSelectionCount = document.querySelector<HTMLElement>("#frame-selection-count")!;
const selectAllFramesButton = document.querySelector<HTMLButtonElement>("#select-all-frames")!;
const clearFrameSelectionButton = document.querySelector<HTMLButtonElement>("#clear-frame-selection")!;
const layerAssetReportPanel = document.querySelector<HTMLElement>("#layer-asset-report")!;
const layerAssetReportSummary = document.querySelector<HTMLElement>("#asset-report-summary")!;
const layerAssetReportCopy = document.querySelector<HTMLElement>("#asset-report-copy")!;
const layerAssetExportList = document.querySelector<HTMLUListElement>("#asset-export-list")!;
const result = document.querySelector<HTMLElement>("#result")!;
const resultLink = document.querySelector<HTMLAnchorElement>("#result-link")!;
const copyResultLinkButton = document.querySelector<HTMLButtonElement>("#copy-result-link")!;
const uploadHint = document.querySelector<HTMLElement>("#upload-hint")!;
const frameFilterInput = document.querySelector<HTMLInputElement>("#frame-filter")!;
const resultProjectId = document.querySelector<HTMLElement>("#result-project-id")!;
const resultHandoffId = document.querySelector<HTMLElement>("#result-handoff-id")!;
const resultVersionId = document.querySelector<HTMLElement>("#result-version-id")!;
const replacementReview = document.querySelector<HTMLElement>("#replacement-review")!;
const replacementList = document.querySelector<HTMLElement>("#replacement-list")!;
const replacementValidation = document.querySelector<HTMLElement>("#replacement-validation")!;
const confirmReplacementsButton = document.querySelector<HTMLButtonElement>("#confirm-replacements-button")!;
const skipReplacementsButton = document.querySelector<HTMLButtonElement>("#skip-replacements-button")!;
const pageChoicePanel = document.querySelector<HTMLElement>("#page-choice")!;
const pageChoiceIntro = document.querySelector<HTMLElement>("#page-choice-intro")!;
const pageChoiceReplaceDetail = document.querySelector<HTMLElement>("#page-choice-replace-detail")!;
const pageChoiceAddDetail = document.querySelector<HTMLElement>("#page-choice-add-detail")!;
const pageChoiceValidation = document.querySelector<HTMLElement>("#page-choice-validation")!;
const confirmPageChoiceButton = document.querySelector<HTMLButtonElement>("#confirm-page-choice-button")!;
appUrlInput.value = __ASBIR_HANDOFF_ORIGIN__;
appUrlInput.readOnly = true;

function excludedTopLevelSections() {
  if (scopeInput.value !== "page" && scopeInput.value !== "page-merge") return [];
  return [...new Set(excludedSectionsInput.value.split(",").map((name) => name.trim()).filter(Boolean))];
}

function updatePageExclusionsVisibility() {
  const isPageScope = scopeInput.value === "page" || scopeInput.value === "page-merge";
  pageExclusions.hidden = !isPageScope;
  scopeHelp.textContent = scopeInput.value === "page-merge"
    ? "Merge the current page into the latest Handoff version. Uncaptured frames stay in the canvas."
    : scopeInput.value === "page"
      ? "Replace the current page’s frames in the latest Handoff version."
      : scopeInput.value === "file"
        ? "Capture every page in the Figma file. This can take longer."
        : "Selected captures use their containing frames. Selecting a section captures every frame in it and replaces that section in Handoff: screens removed from the section disappear.";
}

scopeInput.addEventListener("change", updatePageExclusionsVisibility);
updatePageExclusionsVisibility();

type FrameReplacementCandidate = {
  beforeFrameId: string;
  beforeName: string;
  afterCandidates: Array<{ frameId: string; name: string; score: number }>;
};

type FrameReplacementMatch = { beforeFrameId: string; afterFrameId: string };
type CaptureMergeContext = {
  versionId: string;
  overviewUrl: string;
  overviewWidth: number | null;
  overviewHeight: number | null;
  canvasBounds: SnapshotEnvelope["canvasBounds"] | null;
  frames: Array<Pick<SnapshotFrame, "sourceFrameId" | "sourcePageId" | "bounds" | "renderBounds"> & { name?: string }>;
  pageLayout: unknown;
  /** Sections in the previous version, so a re-captured section can replace its screens. */
  sections?: unknown;
};
type PendingUpload = {
  snapshot: SnapshotEnvelope;
  renders: CaptureAssetBytes[];
  baselineVersionId: string | null;
  mergeContext?: CaptureMergeContext;
  /** For a page capture of a page the latest version doesn't have: replace the version, or add beside it. */
  pageMode?: PageCaptureMode;
  candidates: FrameReplacementCandidate[];
  incomingBytes: number;
  retainedBaselineBytesEstimate: number;
  token: string;
  origin: string;
  uploadSessions: Map<string, { intent: CaptureUploadIntent; state: UploadSessionState; renew: boolean }>;
};

let currentCapture: CaptureReadyMessage | null = null;
let fullCapture: CaptureReadyMessage | null = null;
let overviewBytes: Uint8Array | null = null;
let overviewWidth = 0;
let overviewHeight = 0;
let pendingUpload: PendingUpload | null = null;
let busy = false;
let previewGeneration = 0;
let activeUploadController: AbortController | null = null;

function discardStalePendingUpload() {
  const previous = pendingUpload;
  pendingUpload = retainPendingUploadForToken(previous, tokenInput.value);
  if (!previous || pendingUpload) return false;

  replacementReview.hidden = true;
  replacementList.replaceChildren();
  replacementValidation.textContent = "";
  pageChoicePanel.hidden = true;
  pageChoiceValidation.textContent = "";
  uploadButton.hidden = false;
  updateReplacementActions();
  refreshPrimaryAction();
  setStatus("Capture token changed. Upload again to recheck this captured version before sending it.", "warning");
  return true;
}

function setStatus(message: string, kind: "plain" | "error" | "success" | "warning" = "plain") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function selectedFrameMatches(): FrameReplacementMatch[] {
  return Array.from(replacementList.querySelectorAll<HTMLSelectElement>("select[data-before-frame-id]"))
    .filter((select) => select.value)
    .map((select) => ({ beforeFrameId: select.dataset.beforeFrameId!, afterFrameId: select.value }));
}

function updateReplacementActions() {
  const matches = selectedFrameMatches();
  const duplicateAfter = new Set(matches.map((match) => match.afterFrameId)).size !== matches.length;
  replacementValidation.textContent = duplicateAfter ? "Choose each new frame once." : matches.length ? "" : "Choose a replacement, or upload without matches.";
  confirmReplacementsButton.disabled = busy || !pendingUpload || matches.length === 0 || duplicateAfter;
  skipReplacementsButton.disabled = busy || !pendingUpload;
  confirmReplacementsButton.textContent = matches.length === 1 ? "Confirm 1 match and upload" : `Confirm ${matches.length} matches and upload`;
}

/**
 * One obvious next step: Capture is the main button until a capture is ready, then Upload takes
 * over and says what it will send. A missing token is explained before the click, not after.
 */
function refreshPrimaryAction() {
  const ready = Boolean(currentCapture && overviewBytes);
  const hasToken = Boolean(tokenInput.value.trim());
  uploadButton.disabled = busy || !ready || !hasToken;
  uploadButton.className = ready && hasToken ? "primary" : "secondary";
  captureButton.className = ready ? "secondary" : "primary";
  captureButton.textContent = fullCapture ? "Capture again" : "Capture canvas";
  const count = currentCapture?.payload.frames.length ?? 0;
  const screens = `${count} screen${count === 1 ? "" : "s"}`;
  uploadButton.textContent = !ready ? "Upload to Handoff"
    : fullCapture?.captureAllTopLevel ? `Merge ${screens} into Handoff` : `Upload ${screens} to Handoff`;
  uploadHint.textContent = busy || uploadButton.hidden || !result.hidden ? ""
    : !ready ? (fullCapture ? "Select at least one frame above." : "Capture the canvas first, then upload it here.")
      : !hasToken ? "Paste the capture token above to upload."
        : `${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter also uploads.`;
}

function setBusy(isBusy: boolean) {
  busy = isBusy;
  captureButton.disabled = isBusy;
  refreshPrimaryAction();
  layerAssetModeInput.disabled = isBusy || Boolean(fullCapture);
  frameListFieldset.disabled = isBusy || !fullCapture || Boolean(pendingUpload);
  selectAllFramesButton.disabled = isBusy || !fullCapture || Boolean(pendingUpload);
  frameFilterInput.disabled = isBusy || !fullCapture || Boolean(pendingUpload);
  clearFrameSelectionButton.disabled = isBusy || !fullCapture || Boolean(pendingUpload);
  updateReplacementActions();
}

function setUploadProgress(uploadedBytes: number, totalBytes: number) {
  const percent = totalBytes ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 100;
  uploadProgress.value = percent;
  setStatus(`Uploading captured files to private Storage… ${percent}%`);
}

function selectedFrameIds() {
  return new Set(Array.from(frameList.querySelectorAll<HTMLInputElement>("input[data-frame-id]:checked"))
    .map((checkbox) => checkbox.dataset.frameId!)
    .filter(Boolean));
}

function updateFrameManifestSummary(capture: CaptureReadyMessage) {
  const selectedCount = selectedFrameIds().size;
  const manifestCapture = fullCapture ?? capture;
  const frameCount = manifestCapture.payload.frames.length;
  frameManifestSummary.textContent = `${selectedCount} of ${frameCount} selected`;
  frameSelectionCount.textContent = `${selectedCount} of ${frameCount} captured frames are selected for upload.`;
  const excluded = manifestCapture.excludedSectionCounts.filter((section) => section.frameCount > 0);
  const excludedSummary = excluded.length
    ? `Excluded sections: ${excluded.map(({ name, frameCount: count }) => `${name} (${count} frame${count === 1 ? "" : "s"})`).join(", ")}.`
    : "No top-level frames were excluded by section name.";
  const selectionSummary = manifestCapture.captureAllTopLevel
    ? "Merge mode keeps unchecked frames from the previous Handoff version."
    : manifestCapture.scope === "page" || manifestCapture.scope === "file"
      ? "Replace scope uploads only checked frames; unchecked frames won't be part of this replacement capture."
      : "Selected scope uploads only checked frames.";
  frameManifestIntro.textContent = `${excludedSummary} ${selectionSummary}`;
}

/** Rows matching the frame filter (all rows when it is empty). */
function visibleFrameCheckboxes() {
  return Array.from(frameList.querySelectorAll<HTMLInputElement>("input[data-frame-id]"))
    .filter((checkbox) => !checkbox.closest("li")?.hidden);
}

function applyFrameFilter() {
  const needle = frameFilterInput.value.trim().toLowerCase();
  for (const item of Array.from(frameList.children) as HTMLElement[]) {
    item.hidden = Boolean(needle) && !(item.textContent ?? "").toLowerCase().includes(needle);
  }
  const shown = visibleFrameCheckboxes().length;
  const total = frameList.children.length;
  selectAllFramesButton.textContent = needle && shown < total ? `Select ${shown} shown` : "Select all";
  clearFrameSelectionButton.textContent = needle && shown < total ? "Clear shown" : "Select none";
}

function renderFrameManifest(capture: CaptureReadyMessage) {
  frameList.replaceChildren();
  frameFilterInput.value = "";
  capture.payload.frames.forEach((frame, index) => {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const title = document.createElement("span");
    const pageId = document.createElement("small");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.frameId = frame.sourceFrameId;
    checkbox.id = `capture-frame-${index}`;
    label.className = "frame-row";
    title.textContent = frame.name || "Untitled frame";
    pageId.textContent = `Page ${frame.sourcePageId} · Frame ${frame.sourceFrameId}`;
    title.append(pageId);
    label.htmlFor = checkbox.id;
    label.append(checkbox, title);
    item.append(label);
    frameList.append(item);
    checkbox.addEventListener("change", scheduleSelectedCaptureUpdate);
  });
  frameManifest.hidden = false;
  applyFrameFilter();
  updateFrameManifestSummary(capture);
}

function updateLayerAssetReport(capture: CaptureReadyMessage) {
  const report = capture.layerAssetReport;
  const modeLabel: Record<LayerAssetMode, string> = {
    recommended: "Recommended priority",
    raster: "Raster images only",
    none: "Individual asset exports off",
  };
  const notes = [
    `${report.exportedCount} exported`,
    `${report.eligibleCount} eligible`,
    report.modeSkippedCount ? `${report.modeSkippedCount} excluded by mode` : "",
    report.limitSkippedCount ? `${report.limitSkippedCount} skipped by the ${report.limit.toLocaleString()}-item cap` : "",
    report.sizeSkippedCount ? `${report.sizeSkippedCount} skipped by size limits` : "",
    report.exportFailureCount ? `${report.exportFailureCount} failed` : "",
    report.fallbackCount ? `${report.fallbackCount} used PNG fallback` : "",
  ].filter(Boolean);
  layerAssetReportSummary.textContent = `Layer assets: ${report.exportedCount} exported`;
  layerAssetReportCopy.textContent = capture.payload.frames.length === 0
    ? "Select at least one frame to see the layer assets for upload."
    : report.eligibleCount
    ? `${modeLabel[report.mode]}. ${notes.join(" · ")}. Structured layers remain available even when separate assets are omitted.`
    : "No eligible individual layer assets were found. Frame renders and structured layers are still included.";
  layerAssetExportList.replaceChildren();
  if (capture.layerRenders.length) {
    for (const asset of capture.layerRenders) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const detail = document.createElement("small");
      item.className = "asset-report-row";
      name.textContent = asset.sourceLayerName || asset.fileName;
      detail.textContent = `${asset.sourceFrameName} · ${asset.contentType === "image/png" ? "PNG" : "SVG"} · ${asset.fileName}`;
      item.append(name, detail);
      layerAssetExportList.append(item);
    }
  } else {
    const item = document.createElement("li");
    item.className = "asset-report-row";
    item.textContent = "No separate layer assets will be uploaded.";
    layerAssetExportList.append(item);
  }
  layerAssetReportPanel.hidden = false;
}

function updateCaptureSummary(capture: CaptureReadyMessage, width: number, height: number) {
  const nodeCount = capture.payload.frames.reduce((count, frame) => count + frame.nodes.length, 0);
  const frameCount = capture.payload.frames.length;
  const pageCount = Array.isArray(capture.payload.sourceMetadata.pageLayout)
    ? capture.payload.sourceMetadata.pageLayout.length
    : 0;
  const renderScale = capture.payload.sourceMetadata.renderScale === 2 ? "2×" : "1×";
  const vectorSourceCount = capture.vectorRenders.length;
  const fallbackFrameIds = Array.isArray(capture.payload.sourceMetadata.renderScaleFallbackFrameIds)
    ? capture.payload.sourceMetadata.renderScaleFallbackFrameIds.filter((frameId): frameId is string => typeof frameId === "string")
    : [];
  const vectorSummary = vectorSourceCount ? ` · ${vectorSourceCount}/${frameCount} frame SVGs retained` : "";
  const scaleSummary = fallbackFrameIds.length === frameCount
    ? "1× Figma render"
    : fallbackFrameIds.length
      ? `${renderScale} Figma render · ${fallbackFrameIds.length} frame${fallbackFrameIds.length === 1 ? "" : "s"} rendered at 1×`
      : `${renderScale} Figma render`;
  const duplicateFrameNames = findDuplicateFrameNames(capture.payload.frames);
  const blankFrameNameCount = countBlankFrameNames(capture.payload.frames);
  const warningSummary = capture.warnings.length ? ` · ${capture.warnings.length} capture warning${capture.warnings.length === 1 ? "" : "s"}` : "";
  const duplicateNameSummary = duplicateFrameNames.length
    ? ` · ${duplicateFrameNames.length} duplicate screen name${duplicateFrameNames.length === 1 ? "" : "s"}`
    : "";
  const layerExportCount = capture.layerRenders.length;
  const pageSummary = capture.scope === "file" ? ` · ${pageCount} pages` : "";
  const captureScopeSummary = capture.captureAllTopLevel
    ? "All top-level frames and components on the current page (merge)"
    : formatFigmaCaptureScope(capture.scope === "selected" ? capture.payload.sourceMetadata.captureScope : capture.scope);
  const selectedSections = capture.scope === "selected" && !capture.captureAllTopLevel
    ? captureSectionRecords(capture.payload.sourceMetadata)
    : [];
  const sectionSummary = selectedSections.length
    ? ` · replaces section${selectedSections.length === 1 ? "" : "s"} ${selectedSections.map((section) => `${section.name} (${section.frameIds.length})`).join(", ")} in Handoff`
    : "";
  const scopeSummary = captureScopeSummary ? `Capture scope: ${captureScopeSummary} · ` : "";
  const excludedSections = capture.excludedSectionCounts.filter((section) => section.frameCount > 0);
  const exclusionSummary = excludedSections.length
    ? ` · excluded sections: ${excludedSections.map(({ name, frameCount }) => `${name} (${frameCount})`).join(", ")}`
    : "";
  summary.textContent = `${scopeSummary}${frameCount} frame${frameCount === 1 ? "" : "s"}${pageSummary}${sectionSummary}${exclusionSummary} · ${nodeCount.toLocaleString()} layers · ${width} × ${height} px overview · ${scaleSummary}${vectorSummary} · ${layerExportCount} individual layer asset${layerExportCount === 1 ? "" : "s"}${warningSummary}${duplicateNameSummary}`;
  const duplicateNameMessage = duplicateFrameNames.length
    ? `This capture contains duplicate screen names: ${duplicateFrameNames.slice(0, 4).map(({ name, count }) => `${name} (${count})`).join(", ")}${duplicateFrameNames.length > 4 ? `, and ${duplicateFrameNames.length - 4} more` : ""}. Matching these screens by name may be ambiguous.`
    : "";
  const blankNameMessage = blankFrameNameCount
    ? `${blankFrameNameCount} screen${blankFrameNameCount === 1 ? " has" : "s have"} no name. Handoff may not match these screens by name across versions.`
    : "";
  const captureWarningMessage = capture.warnings.length
    ? `Capture warnings: ${capture.warnings.join(" ")} Review the Figma-rendered preview and layer data before uploading.`
    : "";
  const nameWarningMessage = [blankNameMessage, duplicateNameMessage].filter(Boolean).join(" ");
  const statusMessage = [
    nameWarningMessage ? `${nameWarningMessage} You can still upload.` : "",
    captureWarningMessage,
  ].filter(Boolean).join(" ") || "Review the Figma-rendered preview and frame list, then upload this snapshot.";
  setStatus(statusMessage, duplicateFrameNames.length || blankFrameNameCount || capture.warnings.length ? "warning" : "plain");
}

async function prepareSelectedCapture(capture: CaptureReadyMessage) {
  const generation = ++previewGeneration;
  currentCapture = null;
  overviewBytes = null;
  overviewWidth = 0;
  overviewHeight = 0;
  setBusy(true);
  setStatus("Preparing the selected frame preview and layer asset report…");
  try {
    const overview = await createOverviewPng(capture);
    if (generation !== previewGeneration) return;
    currentCapture = capture;
    overviewBytes = overview.bytes;
    overviewWidth = overview.width;
    overviewHeight = overview.height;
    preview.width = overview.width;
    preview.height = overview.height;
    const context = preview.getContext("2d", { alpha: true });
    if (!context) throw new Error("The browser could not create the canvas preview.");
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(overview.canvas, 0, 0, preview.width, preview.height);
    updateFrameManifestSummary(capture);
    updateLayerAssetReport(capture);
    updateCaptureSummary(capture, overview.width, overview.height);
    setBusy(false);
  } catch (error) {
    if (generation !== previewGeneration) return;
    currentCapture = null;
    overviewBytes = null;
    setStatus(error instanceof Error ? error.message : "The canvas overview could not be prepared.", "error");
    setBusy(false);
  }
}

let selectionTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Rebuilding the overview decodes every selected frame, so wait until the clicking stops instead of
 * rebuilding (and locking the list) after each checkbox. Upload stays off until the rebuild is done.
 */
function scheduleSelectedCaptureUpdate() {
  if (!fullCapture) return;
  previewGeneration += 1;
  currentCapture = null;
  overviewBytes = null;
  updateFrameManifestSummary(fullCapture);
  refreshPrimaryAction();
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => { void updateSelectedCapture(); }, 300);
}

async function updateSelectedCapture() {
  clearTimeout(selectionTimer);
  if (!fullCapture) return;
  const includedFrameIds = selectedFrameIds();
  updateFrameManifestSummary(fullCapture);
  if (includedFrameIds.size === 0) {
    previewGeneration += 1;
    currentCapture = null;
    overviewBytes = null;
    overviewWidth = 0;
    overviewHeight = 0;
    preview.width = 1;
    preview.height = 1;
    summary.textContent = "No frames selected for upload.";
    updateLayerAssetReport(filterCaptureToFrameIds(fullCapture, includedFrameIds));
    setStatus("Select at least one frame before uploading.", "warning");
    setBusy(false);
    return;
  }
  const selectedCapture = filterCaptureToFrameIds(fullCapture, includedFrameIds);
  await prepareSelectedCapture(selectedCapture);
}

function pluginMessage(data: unknown) {
  parent.postMessage({ pluginMessage: data }, "*");
}

function assetBlob(bytes: Uint8Array, contentType: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: contentType });
}

function sha256(bytes: Uint8Array) {
  return sha256Hex(bytes);
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, map: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await map(items[index], index);
    }
  }));
  return results;
}

function boundValue(payload: CaptureReadyMessage["payload"], key: "x" | "y" | "width" | "height") {
  return payload.canvasBounds[key].value ?? 0;
}

function loadImage(bytes: Uint8Array, contentType: CaptureAssetBytes["contentType"]) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(assetBlob(bytes, contentType));
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Figma's ${contentType === "image/png" ? "pixel" : "vector"} render could not be decoded.`));
    };
    image.src = url;
  });
}

function svgNumber(value: string | null, fallback: number) {
  const parsed = value ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function canvasPngBytes(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("The browser could not encode the canvas preview as PNG."));
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function createOverviewPng(capture: CaptureReadyMessage) {
  const frameKeys = new Set(capture.renders.map((render) => render.key));
  if (capture.renders.length !== capture.payload.frames.length ||
      capture.payload.frames.some((frame) => !frameKeys.has(frame.renderAssetKey))) {
    throw new Error("Figma returned an incomplete set of frame renders. Capture again before uploading.");
  }
  const x = boundValue(capture.payload, "x");
  const y = boundValue(capture.payload, "y");
  const width = boundValue(capture.payload, "width");
  const height = boundValue(capture.payload, "height");
  if (width <= 0 || height <= 0) throw new Error("The captured canvas does not have valid bounds.");
  const maxDimension = 8192;
  const maxPixels = 12_000_000;
  let scale = Math.min(1, maxDimension / width, maxDimension / height);
  const boundedPixels = width * scale * height * scale;
  if (boundedPixels > maxPixels) scale *= Math.sqrt(maxPixels / boundedPixels);
  const overviewBudget = availableOverviewBudget(
    [...capture.renders, ...capture.vectorRenders, ...capture.layerRenders],
    MAX_CAPTURE_ASSET_BYTES,
  );
  if (overviewBudget <= 0) throw new Error("The captured frame assets leave no room for Handoff’s canvas overview within the 256 MiB capture asset limit.");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvasWidth = Math.max(1, Math.min(maxDimension, Math.round(width * scale)));
    const canvasHeight = Math.max(1, Math.min(maxDimension, Math.round(height * scale)));
    const overview = document.createElement("canvas");
    overview.width = canvasWidth;
    overview.height = canvasHeight;
    const context = overview.getContext("2d", { alpha: true });
    if (!context) throw new Error("The browser could not create the canvas overview.");

    for (const render of capture.renders) {
      if (render.contentType !== "image/png") {
        throw new Error(`The Figma pixel render for ${render.fileName} has an unsupported format.`);
      }
      const image = await loadImage(render.bytes, render.contentType);
      const renderBounds = render.renderBounds ?? {
        x: render.sourceX,
        y: render.sourceY,
        width: render.sourceWidth,
        height: render.sourceHeight,
      };
      context.drawImage(
        image,
        (renderBounds.x - x) * scale,
        (renderBounds.y - y) * scale,
        renderBounds.width * scale,
        renderBounds.height * scale,
      );
    }

    const bytes = await canvasPngBytes(overview);
    if (bytes.byteLength <= overviewBudget) return { bytes, canvas: overview, width: canvasWidth, height: canvasHeight };
    overview.width = 1;
    overview.height = 1;
    scale *= Math.min(0.85, Math.sqrt(overviewBudget / bytes.byteLength) * 0.9);
    if (attempt < 4) setStatus("Reducing only the overview resolution to fit the import limit. Individual Figma frame renders stay unchanged.");
  }
  throw new Error("The overview still exceeds Handoff’s 256 MiB capture asset limit after reducing its resolution.");
}

function measuredRect(bounds: SnapshotFrame["bounds"] | undefined) {
  if (!bounds) return null;
  const { x, y, width, height } = bounds;
  if (x.value === null || y.value === null || width.value === null || height.value === null) return null;
  if (![x.value, y.value, width.value, height.value].every(Number.isFinite) || width.value <= 0 || height.value <= 0) return null;
  return { x: x.value, y: y.value, width: width.value, height: height.value };
}

async function createMergedOverviewPng(
  pending: PendingUpload,
  frameMatches: FrameReplacementMatch[],
) {
  const merge = pending.mergeContext;
  const capture = currentCapture;
  if (!merge || !capture || !overviewBytes) throw new Error("The previous canvas overview is unavailable. Capture again before uploading.");
  if (merge.versionId !== pending.baselineVersionId) throw new Error("The merge preview no longer matches the selected baseline version.");

  const overviewUrl = new URL(merge.overviewUrl, pending.origin);
  if (overviewUrl.origin !== pending.origin) throw new Error("The previous canvas overview came from a different Handoff server.");
  const baselineResponse = await fetch(overviewUrl, {
    headers: { Authorization: `Bearer ${pending.token}` },
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    signal: activeUploadController?.signal,
  });
  if (!baselineResponse.ok) {
    const body = await baselineResponse.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `The previous canvas overview could not be loaded (${baselineResponse.status}).`);
  }
  const baselineUpload = await baselineResponse.json().catch(() => ({})) as {
    url?: string;
    width?: number | null;
    height?: number | null;
    contentType?: string;
    sizeBytes?: number;
    sha256?: string;
    error?: string;
  };
  if (!baselineUpload.url || baselineUpload.contentType !== "image/png") {
    throw new Error(baselineUpload.error || "The previous canvas overview metadata is invalid.");
  }
  const signedOverviewUrl = new URL(baselineUpload.url);
  requireExactOrigin(signedOverviewUrl.origin, __ASBIR_STORAGE_ORIGIN__);
  const signedOverviewResponse = await fetch(signedOverviewUrl, {
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    signal: activeUploadController?.signal,
  });
  if (!signedOverviewResponse.ok) throw new Error(`The previous canvas overview could not be downloaded (${signedOverviewResponse.status}).`);
  const baselineBytes = new Uint8Array(await signedOverviewResponse.arrayBuffer());
  if (baselineUpload.sizeBytes !== baselineBytes.byteLength || baselineUpload.sha256 !== await sha256(baselineBytes)) {
    throw new Error("The previous canvas overview failed its size or SHA-256 check.");
  }
  const [baselineImage, incomingImage] = await Promise.all([
    loadImage(baselineBytes, "image/png"),
    loadImage(overviewBytes, "image/png"),
  ]);
  if ((merge.overviewWidth && baselineImage.naturalWidth !== merge.overviewWidth) ||
      (merge.overviewHeight && baselineImage.naturalHeight !== merge.overviewHeight)) {
    throw new Error("The previous canvas overview dimensions changed. Capture again before uploading.");
  }
  const baselineBounds = measuredRect(merge.canvasBounds ?? undefined) ?? {
    x: 0,
    y: 0,
    width: baselineImage.naturalWidth,
    height: baselineImage.naturalHeight,
  };
  const incomingBounds = measuredRect(pending.snapshot.canvasBounds);
  if (!incomingBounds) throw new Error("The selected capture does not have valid canvas bounds.");

  const plan = createFigmaCaptureMergePlan({
    baseline: {
      frames: merge.frames,
      canvasBounds: merge.canvasBounds ?? undefined,
      sourceMetadata: { pageLayout: merge.pageLayout, sections: merge.sections ?? [] },
    },
    incoming: pending.snapshot,
    frameMatches,
  });
  if (!plan) throw new Error("This Figma capture scope cannot be merged with the previous canvas.");
  const mergedBounds = measuredRect(plan.canvasBounds);
  if (!mergedBounds) throw new Error("The merged canvas does not have valid bounds.");
  const incomingPageIds = new Set(capture.payload.frames.flatMap((frame) => frame.sourcePageId ? [frame.sourcePageId] : []));
  if (incomingPageIds.size > 1) throw new Error("Capture one Figma page at a time when adding frames to an existing version.");

  const baselineScaleX = baselineImage.naturalWidth / baselineBounds.width;
  const baselineScaleY = baselineImage.naturalHeight / baselineBounds.height;
  let scale = Math.min(baselineScaleX, baselineScaleY);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("The previous canvas overview has invalid dimensions.");
  const maxDimension = 8192;
  const maxPixels = 12_000_000;
  scale = Math.min(scale, maxDimension / mergedBounds.width, maxDimension / mergedBounds.height);
  const boundedPixels = mergedBounds.width * scale * mergedBounds.height * scale;
  if (boundedPixels > maxPixels) scale *= Math.sqrt(maxPixels / boundedPixels);
  const overviewBudget = availableOverviewBudget(
    [...capture.renders, ...capture.vectorRenders, ...capture.layerRenders],
    MAX_CAPTURE_ASSET_BYTES,
  );
  if (overviewBudget <= 0) throw new Error("The captured frame assets leave no room for the merged overview within the 256 MiB asset limit.");

  const incomingPageId = [...incomingPageIds][0];
  const incomingDelta = incomingPageId ? plan.incomingOffsetDeltas.get(incomingPageId) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  const clearRects = getFigmaCaptureOverviewClearRects(
    merge.frames,
    plan.replacedFrameIds,
    plan.pageOffsets,
  );
  const keepRects = getFigmaCaptureOverviewKeepRects(
    merge.frames,
    plan.replacedFrameIds,
    plan.pageOffsets,
  );
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.min(maxDimension, Math.round(mergedBounds.width * scale)));
    canvas.height = Math.max(1, Math.min(maxDimension, Math.round(mergedBounds.height * scale)));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("The browser could not create the merged canvas overview.");

    // Copy only the kept screens from the previous picture: anything else in it is stale
    // (screens removed since it was drawn would otherwise reappear in the merged version).
    context.save();
    context.beginPath();
    for (const bounds of keepRects) {
      context.rect((bounds.x - mergedBounds.x) * scale, (bounds.y - mergedBounds.y) * scale, bounds.width * scale, bounds.height * scale);
    }
    context.clip();
    context.drawImage(
      baselineImage,
      (baselineBounds.x - mergedBounds.x) * scale,
      (baselineBounds.y - mergedBounds.y) * scale,
      baselineBounds.width * scale,
      baselineBounds.height * scale,
    );
    context.restore();
    for (const bounds of clearRects) {
      context.clearRect(
        (bounds.x - mergedBounds.x) * scale,
        (bounds.y - mergedBounds.y) * scale,
        bounds.width * scale,
        bounds.height * scale,
      );
    }
    context.drawImage(
      incomingImage,
      (incomingBounds.x + incomingDelta.x - mergedBounds.x) * scale,
      (incomingBounds.y + incomingDelta.y - mergedBounds.y) * scale,
      incomingBounds.width * scale,
      incomingBounds.height * scale,
    );

    const bytes = await canvasPngBytes(canvas);
    if (bytes.byteLength <= overviewBudget) return { bytes, width: canvas.width, height: canvas.height };
    canvas.width = 1;
    canvas.height = 1;
    scale *= Math.min(0.85, Math.sqrt(overviewBudget / bytes.byteLength) * 0.9);
    if (attempt < 4) setStatus("Reducing only the merged overview resolution to fit the import limit. Individual Figma frame renders stay unchanged.");
  }
  throw new Error("The merged overview still exceeds Handoff’s 256 MiB asset limit after reducing its resolution.");
}

async function cropFrameRender(render: CaptureAssetBytes): Promise<CaptureAssetBytes> {
  if (render.contentType !== "image/png" || !render.renderBounds) return render;
  const image = await loadImage(render.bytes, render.contentType);
  const crop = frameRenderCrop(
    { x: render.sourceX, y: render.sourceY, width: render.sourceWidth, height: render.sourceHeight },
    render.renderBounds,
    image.naturalWidth,
    image.naturalHeight,
  );
  if (!crop) return { ...render, renderBounds: undefined };

  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error(`The browser could not crop the Figma render for ${render.fileName}.`);
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return { ...render, bytes: await canvasPngBytes(canvas), renderBounds: undefined };
}

function assetMetadata(
  image: CaptureAssetBytes,
  dimensions: { width: number; height: number },
  digest: string,
): SnapshotAsset {
  return {
    key: image.key,
    fileName: image.fileName,
    contentType: image.contentType,
    sizeBytes: image.bytes.byteLength,
    sha256: digest,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function dimensionsOf(asset: CaptureAssetBytes): { width: number; height: number } {
  if (asset.contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (asset.bytes.byteLength < 24 || signature.some((byte, index) => asset.bytes[index] !== byte)) {
      throw new Error(`Figma returned an invalid PNG render for ${asset.fileName}.`);
    }
    const view = new DataView(asset.bytes.buffer, asset.bytes.byteOffset, asset.bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (!width || !height || width > 1_000_000 || height > 1_000_000) {
      throw new Error(`Figma returned invalid PNG dimensions for ${asset.fileName}.`);
    }
    return { width, height };
  }

  const markup = new TextDecoder("utf-8", { fatal: true }).decode(asset.bytes);
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (parsed.querySelector("parsererror") || root.localName !== "svg") {
    throw new Error(`Figma returned invalid SVG for ${asset.fileName}.`);
  }
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = svgNumber(root.getAttribute("width"), viewBox?.[2] ?? asset.sourceWidth);
  const height = svgNumber(root.getAttribute("height"), viewBox?.[3] ?? asset.sourceHeight);
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

function showReplacementReview(candidates: FrameReplacementCandidate[]) {
  replacementList.replaceChildren();
  for (const candidate of candidates) {
    const row = document.createElement("div");
    row.className = "replacement-row";

    const before = document.createElement("p");
    before.className = "replacement-source";
    before.textContent = `Earlier frame · ${candidate.beforeName}`;
    const beforeId = document.createElement("small");
    beforeId.textContent = candidate.beforeFrameId;
    before.append(beforeId);

    const arrow = document.createElement("span");
    arrow.className = "replacement-arrow";
    arrow.textContent = "Possible replacement";

    const select = document.createElement("select");
    select.dataset.beforeFrameId = candidate.beforeFrameId;
    select.setAttribute("aria-label", `Choose a replacement for ${candidate.beforeName}`);
    const keepSeparate = document.createElement("option");
    keepSeparate.value = "";
    keepSeparate.textContent = "Keep frames separate";
    select.append(keepSeparate);
    for (const after of candidate.afterCandidates) {
      const option = document.createElement("option");
      option.value = after.frameId;
      option.textContent = `${after.name} · ${after.frameId}`;
      select.append(option);
    }
    select.addEventListener("change", updateReplacementActions);

    row.append(before, arrow, select);
    replacementList.append(row);
  }
  replacementValidation.textContent = "Choose a replacement, or upload without matches.";
  replacementReview.hidden = false;
  uploadButton.hidden = true;
  updateReplacementActions();
}

function renderUploadAssets(
  snapshot: SnapshotEnvelope,
  overviewAssetBytes: Uint8Array,
  frameRenders: CaptureAssetBytes[],
  vectorRenders: CaptureAssetBytes[],
  layerRenders: CaptureReadyMessage["layerRenders"],
): RenderUploadAsset[] {
  const sources = new Map<string, CaptureAssetBytes | { fileName: string; contentType: string; bytes: Uint8Array }>();
  sources.set(snapshot.overviewAssetKey, { fileName: "overview.png", contentType: "image/png", bytes: overviewAssetBytes });
  [...frameRenders, ...vectorRenders, ...layerRenders].forEach((render) => sources.set(render.key, render));
  return snapshot.assets.map((asset) => {
    const source = sources.get(asset.key);
    if (!source) throw new Error(`The captured bytes for asset ${asset.key} are missing.`);
    if (source.contentType !== asset.contentType || source.bytes.byteLength !== asset.sizeBytes) {
      throw new Error(`The captured bytes for asset ${asset.key} do not match the snapshot metadata.`);
    }
    return { ...asset, assetKey: asset.key, bytes: source.bytes };
  });
}

function snapshotSummary(snapshot: SnapshotEnvelope) {
  return {
    source: snapshot.source,
    sourceFileId: snapshot.sourceFileId,
    sourceFileName: snapshot.sourceFileName,
    sourceMetadata: {
      captureScope: snapshot.sourceMetadata.captureScope,
    },
    frames: snapshot.frames.map(({ sourceFrameId, sourcePageId, name }) => ({
      sourceFrameId,
      sourcePageId,
      name,
    })),
  };
}

function uploadSessionKey(snapshotAsset: SnapshotUploadAsset, assets: RenderUploadAsset[]) {
  return JSON.stringify({
    snapshot: { sizeBytes: snapshotAsset.sizeBytes, sha256: snapshotAsset.sha256 },
    assets: assets.map(({ assetKey, fileName, contentType, sizeBytes, sha256 }) => ({ assetKey, fileName, contentType, sizeBytes, sha256 })),
  });
}

async function finishUpload(frameMatches: FrameReplacementMatch[]) {
  if (!currentCapture || !overviewBytes) return;
  if (discardStalePendingUpload()) {
    void uploadCapture();
    return;
  }
  if (!pendingUpload) return;
  const pending = pendingUpload;
  const controller = new AbortController();
  activeUploadController = controller;
  uploadProgress.hidden = false;
  uploadProgress.value = 0;
  cancelUploadButton.hidden = false;
  cancelUploadButton.disabled = false;
  setBusy(true);
  result.hidden = true;
  setStatus(pending.mergeContext
    ? "Merging this capture with the previous version…"
    : pending.pageMode === "replace"
      ? "Saving this page as the new version…"
      : "Preparing the captured snapshot for direct upload…");

  try {
    const endpoint = new URL("/api/capture-sessions/snapshot", pending.origin);
    let uploadSnapshot = pending.snapshot;
    let uploadOverviewBytes = overviewBytes;
    if (pending.mergeContext) {
      const mergedOverview = await createMergedOverviewPng(pending, frameMatches);
      uploadOverviewBytes = mergedOverview.bytes;
      const overviewAssets = pending.snapshot.assets.map((asset) => asset.key === pending.snapshot.overviewAssetKey
        ? {
            ...asset,
            sizeBytes: mergedOverview.bytes.byteLength,
            sha256: "",
            width: mergedOverview.width,
            height: mergedOverview.height,
          }
        : asset);
      const overviewAsset = overviewAssets.find((asset) => asset.key === pending.snapshot.overviewAssetKey);
      if (!overviewAsset) throw new Error("The captured canvas overview is missing from its snapshot.");
      overviewAsset.sha256 = await sha256(mergedOverview.bytes);
      const { contentHash: _contentHash, ...payload } = pending.snapshot;
      const mergedEnvelope = await createSnapshotEnvelope({ ...payload, assets: overviewAssets });
      if (!mergedEnvelope.success) {
        const first = mergedEnvelope.error.issues[0];
        throw new Error(first ? `Merged capture validation failed: ${first.path.join(".")} ${first.message}` : "Merged capture validation failed.");
      }
      uploadSnapshot = mergedEnvelope.data;
    }

    const postSnapshot = async (
      snapshot: SnapshotEnvelope,
      overviewAssetBytes: Uint8Array,
      vectorRenders: CaptureAssetBytes[],
      layerRenders: CaptureReadyMessage["layerRenders"],
    ) => {
      const jsonBytes = encodeUtf8(JSON.stringify(snapshot));
      // Gzip keeps every byte of the capture but makes large pages fit Storage's per-file limit.
      const gzippedBytes = await gzipSnapshotBytes(jsonBytes);
      const snapshotBytes = gzippedBytes ?? jsonBytes;
      const snapshotAsset: SnapshotUploadAsset = {
        fileName: gzippedBytes ? "snapshot.json.gz" : "snapshot.json",
        contentType: gzippedBytes ? SNAPSHOT_GZIP_CONTENT_TYPE : SNAPSHOT_JSON_CONTENT_TYPE,
        sizeBytes: snapshotBytes.byteLength,
        sha256: await sha256(snapshotBytes),
        bytes: snapshotBytes,
      };
      const assets = renderUploadAssets(snapshot, overviewAssetBytes, pending.renders, vectorRenders, layerRenders);
      const key = uploadSessionKey(snapshotAsset, assets);
      let cachedUpload = pending.uploadSessions.get(key);
      const renewIntent = Boolean(cachedUpload?.renew || (!cachedUpload && pending.uploadSessions.size > 0));
      if (!cachedUpload || cachedUpload.renew) {
        setStatus("Requesting one-time upload paths…");
        const intent = await requestCaptureUploadIntent({
          handoffOrigin: pending.origin,
          expectedStorageOrigin: __ASBIR_STORAGE_ORIGIN__,
          token: pending.token,
          snapshot: {
            sizeBytes: snapshotAsset.sizeBytes,
            sha256: snapshotAsset.sha256,
            ...(gzippedBytes ? { encoding: "gzip" as const } : {}),
          },
          assets: assets.map(({ assetKey, fileName, contentType, sizeBytes, sha256: assetHash }) => ({
            assetKey,
            fileName,
            contentType,
            sizeBytes,
            sha256: assetHash,
          })),
          renew: renewIntent,
          signal: controller.signal,
        });
        cachedUpload = { intent, state: createUploadSessionState(), renew: false };
        pending.uploadSessions.set(key, cachedUpload);
      }
      setStatus("Uploading the captured snapshot and renders directly to private Storage…");
      const staged = await uploadCaptureAssets({
        intent: cachedUpload.intent,
        snapshotAsset,
        assets,
        expectedStorageOrigin: __ASBIR_STORAGE_ORIGIN__,
        session: cachedUpload.state,
        signal: controller.signal,
        onProgress: setUploadProgress,
      });
      if (frameMatches.length && !pending.baselineVersionId) {
        throw new Error("A previous handoff version is required to confirm frame replacements.");
      }
      setStatus("Finalizing the uploaded snapshot…");
      const finalizeInit: RequestInit = {
        method: "POST",
        headers: { Authorization: `Bearer ${pending.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildFinalizeManifest({
          snapshotPath: staged.snapshotPath,
          assets: staged.assets,
          baselineVersionId: pending.baselineVersionId,
          frameMatches,
          ...(pending.pageMode ? { pageMode: pending.pageMode } : {}),
        })),
        mode: "cors",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      };
      const finalize = () => sendFinalizeWithRetry(() => fetch(endpoint, finalizeInit), {
        signal: controller.signal,
        onRetry: (attempt) => setStatus(`The connection to Handoff dropped while finalizing. Checking whether it saved the snapshot (attempt ${attempt + 1})…`, "warning"),
      });
      let response = await finalize();
      let body = await response.json().catch(() => ({})) as {
        error?: string;
        code?: string;
        retryUpload?: boolean;
        projectId?: string;
        handoffId?: string;
        versionId?: string;
        reviewUrl?: string;
      };
      if (response.status === 401 && body.code === "capture_token_expired") {
        await renewCaptureSession({ handoffOrigin: pending.origin, token: pending.token, signal: controller.signal });
        response = await finalize();
        body = await response.json().catch(() => ({})) as typeof body;
      }
      if (!response.ok && body.retryUpload) {
        cachedUpload.renew = true;
        cachedUpload.state = createUploadSessionState();
      }
      return { response, body };
    };

    let vectorRenders = currentCapture.vectorRenders;
    let layerRenders = currentCapture.layerRenders;
    let fallbackUsed = false;
    let { response, body } = await postSnapshot(uploadSnapshot, uploadOverviewBytes, vectorRenders, layerRenders);
    if (!response.ok && body.retryUpload) {
      setStatus("Storage could not verify one or more staged files. Reissuing scoped paths and retrying this captured snapshot…");
      ({ response, body } = await postSnapshot(uploadSnapshot, uploadOverviewBytes, vectorRenders, layerRenders));
    }
    if (!response.ok && isRejectedSvgAssetResponse(response.status, body.error ?? "")) {
      const fallback = makeRasterOnlyFallback(uploadSnapshot, { vectorRenders, layerRenders });
      if (fallback.removedAssetKeys.length) {
        setStatus("The server rejected an SVG export. Retrying with PNG renders and structured layer data…");
        const parsedFallback = await createSnapshotEnvelope(fallback.snapshot);
        if (!parsedFallback.success) {
          const first = parsedFallback.error.issues[0];
          throw new Error(first ? `Raster fallback validation failed: ${first.path.join(".")} ${first.message}` : "Raster fallback validation failed.");
        }
        uploadSnapshot = parsedFallback.data;
        vectorRenders = fallback.vectorRenders;
        layerRenders = fallback.layerRenders;
        fallbackUsed = true;
        ({ response, body } = await postSnapshot(uploadSnapshot, uploadOverviewBytes, vectorRenders, layerRenders));
        if (!response.ok && body.retryUpload) {
          setStatus("Storage could not verify one or more staged files. Reissuing scoped paths and retrying this captured snapshot…");
          ({ response, body } = await postSnapshot(uploadSnapshot, uploadOverviewBytes, vectorRenders, layerRenders));
        }
      }
    }
    if (!response.ok || !body.reviewUrl) throw new Error(body.error || `Upload failed with status ${response.status}.`);
    const reviewUrl = new URL(body.reviewUrl);
    if (reviewUrl.origin !== pending.origin) throw new Error("Handoff returned a review link on a different site; check the server URL configuration.");
    resultLink.href = reviewUrl.toString();
    resultProjectId.textContent = body.projectId ?? "Not returned";
    resultHandoffId.textContent = body.handoffId ?? "Not returned";
    resultVersionId.textContent = body.versionId ?? "Not returned";
    result.hidden = false;
    tokenInput.value = "";
    uploadProgress.hidden = true;
    setStatus(fallbackUsed
      ? "Snapshot imported with PNG renders and structured layer data. Rejected SVG assets were omitted; see capture warnings in the snapshot."
      : pending.mergeContext
        ? `Merged ${pending.snapshot.frames.length} captured frame${pending.snapshot.frames.length === 1 ? "" : "s"} into the previous version. Uncaptured frames and their layer data were kept.`
        : frameMatches.length
        ? `Snapshot imported with ${frameMatches.length} confirmed frame ${frameMatches.length === 1 ? "replacement" : "replacements"}.`
        : "Uploaded. Open it in Handoff below.", "success");
    currentCapture = null;
    fullCapture = null;
    overviewBytes = null;
    overviewWidth = 0;
    overviewHeight = 0;
    pendingUpload = null;
    frameManifest.hidden = true;
    frameList.replaceChildren();
    layerAssetReportPanel.hidden = true;
    layerAssetExportList.replaceChildren();
    replacementReview.hidden = true;
    pageChoicePanel.hidden = true;
    uploadButton.hidden = false;
    setBusy(false);
  } catch (error) {
    const wasCanceled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    setStatus(wasCanceled
      ? "Upload canceled. The captured snapshot is ready to retry."
      : error instanceof Error ? error.message : "The snapshot could not be uploaded.", wasCanceled ? "warning" : "error");
    setBusy(false);
  } finally {
    cancelUploadButton.hidden = true;
    cancelUploadButton.disabled = true;
    if (activeUploadController === controller) activeUploadController = null;
  }
}

function megabytes(bytes: number) {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

function showPageChoice(choice: PageCaptureChoice & { baselinePageNames?: string[] }) {
  const pending = pendingUpload;
  if (!pending) return;
  const capturedPage = typeof pending.snapshot.sourceMetadata.sourcePageName === "string"
    ? `“${pending.snapshot.sourceMetadata.sourcePageName}”`
    : "This page";
  const previousPages = choice.baselinePageNames?.length ? choice.baselinePageNames.map((name) => `“${name}”`).join(", ") : "other pages";
  const screens = (count: number) => `${count} ${count === 1 ? "screen" : "screens"}`;
  pageChoiceIntro.textContent = `${capturedPage} isn’t in the latest version, which has ${screens(choice.retainedFrameCount)} from ${previousPages}.`;
  pageChoiceReplaceDetail.textContent = `The new version shows only ${capturedPage} (${screens(pending.snapshot.frames.length)}). Earlier versions stay, so you can compare them. Best for a design revision on a new page.`;
  pageChoiceAddDetail.textContent = `The new version keeps the ${screens(choice.retainedFrameCount)} from ${previousPages} and adds ${capturedPage}.`;
  for (const input of Array.from(pageChoicePanel.querySelectorAll<HTMLInputElement>("input[name=page-mode]"))) {
    input.checked = input.value === choice.suggested;
  }
  pageChoiceValidation.textContent = "";
  pageChoicePanel.hidden = false;
  uploadButton.hidden = true;
  confirmPageChoiceButton.disabled = false;
  setStatus("Choose how to save this page, then continue.");
}

function selectedPageMode(): PageCaptureMode | null {
  const checked = pageChoicePanel.querySelector<HTMLInputElement>("input[name=page-mode]:checked");
  return checked?.value === "replace" || checked?.value === "add" ? checked.value : null;
}

/** Merged captures keep earlier screens; stop before uploading if the result can't fit the snapshot limit. */
function mergedSizeError(pending: PendingUpload) {
  if (!pending.mergeContext) return null;
  const estimate = pending.incomingBytes + pending.retainedBaselineBytesEstimate;
  if (estimate <= MAX_SNAPSHOT_JSON_BYTES) return null;
  return `Keeping the earlier screens would make this version about ${megabytes(estimate)}, over Handoff’s ${megabytes(MAX_SNAPSHOT_JSON_BYTES)} limit. ` +
    (pending.pageMode === "add" ? "Choose “Make it the new version”, or capture fewer frames." : "Capture fewer frames in each update.");
}

async function continueAfterPreview() {
  if (!pendingUpload) return;
  if (discardStalePendingUpload()) {
    void uploadCapture();
    return;
  }
  const pending = pendingUpload;
  if (pending.pageMode === "replace") pending.mergeContext = undefined;
  const sizeError = mergedSizeError(pending);
  if (sizeError) {
    if (!pageChoicePanel.hidden) pageChoiceValidation.textContent = sizeError;
    setStatus(sizeError, "error");
    setBusy(false);
    return;
  }
  pageChoicePanel.hidden = true;
  if (pending.candidates.length) {
    showReplacementReview(pending.candidates);
    setStatus(pending.mergeContext
      ? "Review the suggested replacements. This capture will merge into the latest version and keep untouched frames."
      : "Review the suggested frame replacements before uploading.");
    setBusy(false);
    return;
  }
  await finishUpload([]);
}

async function uploadCapture() {
  if (!currentCapture || !overviewBytes) return;
  const token = tokenInput.value.trim();
  const rawUrl = appUrlInput.value.trim();
  if (!token) {
    setStatus("Paste the one-time capture token from Asbir Handoff.", "error");
    tokenInput.focus();
    return;
  }
  let appUrl: URL;
  try {
    appUrl = new URL(rawUrl);
    if (appUrl.protocol !== "https:" && !(appUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname))) {
      throw new Error("Use HTTPS for the Handoff URL, except for localhost development.");
    }
    if (appUrl.origin !== __ASBIR_HANDOFF_ORIGIN__) {
      throw new Error("This plugin was built for a different Handoff server. Rebuild it with HANDOFF_PUBLIC_URL set to this app.");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Enter a valid Handoff URL.", "error");
    appUrlInput.focus();
    return;
  }

  setBusy(true);
  result.hidden = true;
  replacementReview.hidden = true;
  pageChoicePanel.hidden = true;
  uploadButton.hidden = false;
  pendingUpload = null;
  setStatus("Preparing the captured version…");
  try {
    // A few at a time: each crop decodes a full 2x render, and all at once can exhaust the iframe's memory.
    const frameRenders = await mapWithConcurrency(currentCapture.renders, 4, (render) => cropFrameRender(render));
    const frameDimensions = frameRenders.map(dimensionsOf);
    const renderMetadata = await mapWithConcurrency(frameRenders, 8, async (render, index) =>
      assetMetadata(render, frameDimensions[index], await sha256(render.bytes)),
    );
    const vectorDimensions = currentCapture.vectorRenders.map(dimensionsOf);
    const vectorMetadata = await mapWithConcurrency(currentCapture.vectorRenders, 8, async (render, index) =>
      assetMetadata(render, vectorDimensions[index], await sha256(render.bytes)),
    );
    const layerDimensions = currentCapture.layerRenders.map(dimensionsOf);
    const layerMetadata = await mapWithConcurrency(currentCapture.layerRenders, 8, async (render, index) =>
      assetMetadata(render, layerDimensions[index], await sha256(render.bytes)),
    );
    const overviewDescriptor = {
      key: "overview",
      fileName: "overview.png",
      contentType: "image/png",
      sizeBytes: overviewBytes.byteLength,
      sha256: await sha256(overviewBytes),
      width: overviewWidth,
      height: overviewHeight,
    } satisfies SnapshotAsset;
    const payload: SnapshotPayload = {
      ...currentCapture.payload,
      overviewAssetKey: "overview",
      assets: [overviewDescriptor, ...renderMetadata, ...vectorMetadata, ...layerMetadata],
    };
    const parsed = await createSnapshotEnvelope(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(first ? `Capture validation failed: ${first.path.join(".")} ${first.message}` : "Capture validation failed.");
    }

    setStatus("Checking for possible frame replacements…");
    const previewEndpoint = new URL("/api/capture-sessions/preview", appUrl.origin);
    const previewResponse = await fetch(previewEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ snapshotSummary: snapshotSummary(parsed.data) }),
      mode: "cors",
      credentials: "omit",
      redirect: "error",
    });
    const previewBody = await previewResponse.json().catch(() => ({})) as {
      error?: string;
      baselineVersionId?: string | null;
      candidates?: FrameReplacementCandidate[];
      mergeContext?: CaptureMergeContext;
      pageChoice?: PageCaptureChoice & { baselinePageNames?: string[] };
      retainedBaselineBytesEstimate?: number;
    };
    if (!previewResponse.ok || !previewBody.candidates) throw new Error(previewBody.error || `The replacement check failed with status ${previewResponse.status}.`);
    if (tokenInput.value.trim() !== token) {
      throw new Error("The capture token changed during the replacement check. Upload again to recheck this captured version.");
    }
    if (previewBody.mergeContext && previewBody.mergeContext.versionId !== previewBody.baselineVersionId) {
      throw new Error("The selected capture’s merge preview does not match the current handoff version. Capture again before uploading.");
    }
    pendingUpload = {
      snapshot: parsed.data,
      renders: frameRenders,
      baselineVersionId: previewBody.baselineVersionId ?? null,
      mergeContext: previewBody.mergeContext,
      candidates: previewBody.candidates,
      incomingBytes: jsonByteLength(parsed.data),
      retainedBaselineBytesEstimate: Number(previewBody.retainedBaselineBytesEstimate) || 0,
      token,
      origin: appUrl.origin,
      uploadSessions: new Map(),
    };
    if (previewBody.pageChoice && previewBody.mergeContext) {
      showPageChoice(previewBody.pageChoice);
      setBusy(false);
      return;
    }
    await continueAfterPreview();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The snapshot could not be uploaded.", "error");
    setBusy(false);
  }
}

captureButton.addEventListener("click", () => {
  previewGeneration += 1;
  currentCapture = null;
  fullCapture = null;
  overviewBytes = null;
  overviewWidth = 0;
  overviewHeight = 0;
  pendingUpload = null;
  frameManifest.hidden = true;
  frameList.replaceChildren();
  layerAssetReportPanel.hidden = true;
  layerAssetExportList.replaceChildren();
  replacementReview.hidden = true;
  pageChoicePanel.hidden = true;
  replacementList.replaceChildren();
  uploadButton.hidden = false;
  uploadButton.disabled = true;
  result.hidden = true;
  summary.textContent = "";
  preview.width = 1;
  preview.height = 1;
  setBusy(true);
  setStatus("Reading the Figma canvas…");
  const captureAllTopLevel = scopeInput.value === "page-merge";
  const scope = captureAllTopLevel ? "selected" : scopeInput.value;
  pluginMessage({
    type: "capture",
    scope,
    captureAllTopLevel,
    excludedTopLevelSections: excludedTopLevelSections(),
    layerAssetMode: layerAssetModeInput.value as LayerAssetMode,
  });
});

frameFilterInput.addEventListener("input", applyFrameFilter);

selectAllFramesButton.addEventListener("click", () => {
  visibleFrameCheckboxes().forEach((checkbox) => { checkbox.checked = true; });
  void updateSelectedCapture();
});

clearFrameSelectionButton.addEventListener("click", () => {
  visibleFrameCheckboxes().forEach((checkbox) => { checkbox.checked = false; });
  void updateSelectedCapture();
});

uploadButton.addEventListener("click", () => {
  if (discardStalePendingUpload()) {
    void uploadCapture();
    return;
  }
  void (pendingUpload ? finishUpload([]) : uploadCapture());
});
tokenInput.addEventListener("input", () => {
  discardStalePendingUpload();
  refreshPrimaryAction();
});

// Figma's plugin frame can block the async clipboard API; fall back to a selected text field.
copyResultLinkButton.addEventListener("click", async () => {
  const link = resultLink.href;
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    const field = Object.assign(document.createElement("textarea"), { value: link });
    document.body.append(field);
    field.select();
    copied = document.execCommand("copy");
    field.remove();
  }
  copyResultLinkButton.textContent = copied ? "Copied" : "Copy failed";
  window.setTimeout(() => { copyResultLinkButton.textContent = "Copy link"; }, 1600);
});

// Cmd/Ctrl+Enter runs the main action: capture, then upload.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || busy) return;
  const target = !uploadButton.hidden && !uploadButton.disabled ? uploadButton : !captureButton.disabled ? captureButton : null;
  if (!target) return;
  event.preventDefault();
  target.click();
});
cancelUploadButton.addEventListener("click", () => activeUploadController?.abort());
confirmReplacementsButton.addEventListener("click", () => { void finishUpload(selectedFrameMatches()); });
skipReplacementsButton.addEventListener("click", () => { void finishUpload([]); });
confirmPageChoiceButton.addEventListener("click", () => {
  if (!pendingUpload || busy) return;
  const mode = selectedPageMode();
  if (!mode) {
    pageChoiceValidation.textContent = "Choose how to save this page.";
    return;
  }
  pendingUpload.pageMode = mode;
  confirmPageChoiceButton.disabled = true;
  void continueAfterPreview().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "The snapshot could not be uploaded.", "error");
    confirmPageChoiceButton.disabled = false;
    setBusy(false);
  });
});

window.onmessage = (event: MessageEvent) => {
  const message = (event.data as { pluginMessage?: unknown } | undefined)?.pluginMessage;
  if (!message || typeof message !== "object") return;
  const data = message as CaptureReadyMessage | CaptureProgressMessage | CaptureErrorMessage;
  if (data.type === "capture-progress") {
    setStatus(data.message);
    return;
  }
  if (data.type === "capture-error") {
    setStatus(data.message, "error");
    setBusy(false);
    return;
  }
  if (data.type !== "capture-ready") return;
  fullCapture = data;
  renderFrameManifest(data);
  const includedFrameIds = selectedFrameIds();
  void prepareSelectedCapture(filterCaptureToFrameIds(data, includedFrameIds));
};

setBusy(false);
setStatus("Connect with the one-time token from a Handoff project.");

// Tell people when Integrations hands out a newer build. Quiet on any failure: it's only a hint.
const updateBanner = document.querySelector<HTMLElement>("#update-banner")!;
document.querySelector<HTMLButtonElement>("#update-button")!.addEventListener("click", () => pluginMessage({ type: "open-update" }));
void fetch(pluginVersionUrl(__ASBIR_HANDOFF_ORIGIN__), { cache: "no-store" })
  .then((response) => (response.ok ? response.json() : null))
  .then((payload: unknown) => { updateBanner.hidden = !isPluginOutdated(__ASBIR_PLUGIN_BUILD__, payload); })
  .catch(() => {});
