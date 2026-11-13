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
} from "@asbir/snapshot-contract";
import { encodeUtf8 } from "../../../packages/snapshot-contract/src/utf8";
import type {
  CaptureAssetBytes,
  CaptureErrorMessage,
  CaptureProgressMessage,
  CaptureReadyMessage,
} from "./types";
import { isRejectedSvgAssetResponse, makeRasterOnlyFallback } from "./raster-fallback";
import { frameRenderCrop } from "./render-crop";
import { availableOverviewBudget } from "./transfer-budget";
import { countBlankFrameNames, findDuplicateFrameNames } from "./frame-names";
import { formatFigmaCaptureScope } from "@asbir/snapshot-contract";

declare const __ASBIR_HANDOFF_ORIGIN__: string;

const appUrlInput = document.querySelector<HTMLInputElement>("#app-url")!;
const tokenInput = document.querySelector<HTMLInputElement>("#capture-token")!;
const scopeInput = document.querySelector<HTMLSelectElement>("#capture-scope")!;
const captureButton = document.querySelector<HTMLButtonElement>("#capture-button")!;
const uploadButton = document.querySelector<HTMLButtonElement>("#upload-button")!;
const status = document.querySelector<HTMLElement>("#status")!;
const preview = document.querySelector<HTMLCanvasElement>("#canvas-preview")!;
const summary = document.querySelector<HTMLElement>("#capture-summary")!;
const result = document.querySelector<HTMLElement>("#result")!;
const resultLink = document.querySelector<HTMLAnchorElement>("#result-link")!;
const resultProjectId = document.querySelector<HTMLElement>("#result-project-id")!;
const resultHandoffId = document.querySelector<HTMLElement>("#result-handoff-id")!;
const resultVersionId = document.querySelector<HTMLElement>("#result-version-id")!;
const replacementReview = document.querySelector<HTMLElement>("#replacement-review")!;
const replacementList = document.querySelector<HTMLElement>("#replacement-list")!;
const replacementValidation = document.querySelector<HTMLElement>("#replacement-validation")!;
const confirmReplacementsButton = document.querySelector<HTMLButtonElement>("#confirm-replacements-button")!;
const skipReplacementsButton = document.querySelector<HTMLButtonElement>("#skip-replacements-button")!;
appUrlInput.value = __ASBIR_HANDOFF_ORIGIN__;
appUrlInput.readOnly = true;

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
  frames: Array<Pick<SnapshotFrame, "sourceFrameId" | "sourcePageId" | "bounds" | "renderBounds">>;
  pageLayout: unknown;
};
type PendingUpload = {
  snapshot: SnapshotEnvelope;
  baselineVersionId: string | null;
  mergeContext?: CaptureMergeContext;
  token: string;
  origin: string;
};

let currentCapture: CaptureReadyMessage | null = null;
let overviewBytes: Uint8Array | null = null;
let overviewWidth = 0;
let overviewHeight = 0;
let pendingUpload: PendingUpload | null = null;
let busy = false;

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

function setBusy(isBusy: boolean) {
  busy = isBusy;
  captureButton.disabled = isBusy;
  uploadButton.disabled = isBusy || !currentCapture || !overviewBytes;
  updateReplacementActions();
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
    if (bytes.byteLength <= overviewBudget) return { bytes, width: canvasWidth, height: canvasHeight };
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
  });
  if (!baselineResponse.ok) {
    const body = await baselineResponse.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `The previous canvas overview could not be loaded (${baselineResponse.status}).`);
  }
  const baselineBytes = new Uint8Array(await baselineResponse.arrayBuffer());
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
      sourceMetadata: { pageLayout: merge.pageLayout },
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
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.min(maxDimension, Math.round(mergedBounds.width * scale)));
    canvas.height = Math.max(1, Math.min(maxDimension, Math.round(mergedBounds.height * scale)));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("The browser could not create the merged canvas overview.");

    context.drawImage(
      baselineImage,
      (baselineBounds.x - mergedBounds.x) * scale,
      (baselineBounds.y - mergedBounds.y) * scale,
      baselineBounds.width * scale,
      baselineBounds.height * scale,
    );
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

async function finishUpload(frameMatches: FrameReplacementMatch[]) {
  if (!currentCapture || !overviewBytes || !pendingUpload) return;
  const pending = pendingUpload;
  setBusy(true);
  result.hidden = true;
  setStatus(pending.mergeContext ? "Merging this capture with the previous version…" : "Uploading the frozen snapshot to Asbir Handoff…");

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
      const form = new FormData();
      form.append("snapshot", JSON.stringify(snapshot));
      const overviewDescriptor = snapshot.assets.find((asset) => asset.key === snapshot.overviewAssetKey);
      if (!overviewDescriptor) throw new Error("The snapshot overview asset is missing.");
      form.append(`asset:${snapshot.overviewAssetKey}`, assetBlob(overviewAssetBytes, "image/png"), overviewDescriptor.fileName);
      currentCapture!.renders.forEach((render) => form.append(`asset:${render.key}`, assetBlob(render.bytes, render.contentType), render.fileName));
      vectorRenders.forEach((render) => form.append(`asset:${render.key}`, assetBlob(render.bytes, render.contentType), render.fileName));
      layerRenders.forEach((render) => form.append(`asset:${render.key}`, assetBlob(render.bytes, render.contentType), render.fileName));
      if (pending.baselineVersionId) form.append("baselineVersionId", pending.baselineVersionId);
      if (frameMatches.length) {
        if (!pending.baselineVersionId) throw new Error("A previous handoff version is required to confirm frame replacements.");
        form.append("frameMatches", JSON.stringify(frameMatches));
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${pending.token}` },
        body: form,
        mode: "cors",
        credentials: "omit",
        redirect: "error",
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        projectId?: string;
        handoffId?: string;
        versionId?: string;
        reviewUrl?: string;
      };
      return { response, body };
    };

    let vectorRenders = currentCapture.vectorRenders;
    let layerRenders = currentCapture.layerRenders;
    let fallbackUsed = false;
    let { response, body } = await postSnapshot(uploadSnapshot, uploadOverviewBytes, vectorRenders, layerRenders);
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
    setStatus(fallbackUsed
      ? "Snapshot imported with PNG renders and structured layer data. Rejected SVG assets were omitted; see capture warnings in the snapshot."
      : pending.mergeContext
        ? `Merged ${pending.snapshot.frames.length} captured frame${pending.snapshot.frames.length === 1 ? "" : "s"} into the previous version. Uncaptured frames and their layer data were kept.`
        : frameMatches.length
        ? `Snapshot imported with ${frameMatches.length} confirmed frame ${frameMatches.length === 1 ? "replacement" : "replacements"}.`
        : "Snapshot imported. Open the frozen canvas in Asbir Handoff.", "success");
    currentCapture = null;
    overviewBytes = null;
    overviewWidth = 0;
    overviewHeight = 0;
    pendingUpload = null;
    replacementReview.hidden = true;
    uploadButton.hidden = false;
    setBusy(false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The snapshot could not be uploaded.", "error");
    setBusy(false);
  }
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
  uploadButton.hidden = false;
  pendingUpload = null;
  setStatus("Preparing the captured version…");
  try {
    const frameDimensions = currentCapture.renders.map(dimensionsOf);
    const renderMetadata = await mapWithConcurrency(currentCapture.renders, 8, async (render, index) =>
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
      body: JSON.stringify({ snapshot: parsed.data }),
      mode: "cors",
      credentials: "omit",
      redirect: "error",
    });
    const previewBody = await previewResponse.json().catch(() => ({})) as {
      error?: string;
      baselineVersionId?: string | null;
      candidates?: FrameReplacementCandidate[];
      mergeContext?: CaptureMergeContext;
    };
    if (!previewResponse.ok || !previewBody.candidates) throw new Error(previewBody.error || `The replacement check failed with status ${previewResponse.status}.`);
    if (previewBody.mergeContext && previewBody.mergeContext.versionId !== previewBody.baselineVersionId) {
      throw new Error("The selected capture’s merge preview does not match the current handoff version. Capture again before uploading.");
    }
    pendingUpload = {
      snapshot: parsed.data,
      baselineVersionId: previewBody.baselineVersionId ?? null,
      mergeContext: previewBody.mergeContext,
      token,
      origin: appUrl.origin,
    };
    if (previewBody.candidates.length) {
      showReplacementReview(previewBody.candidates);
      setStatus(previewBody.mergeContext
        ? "Review the suggested replacements. This capture will merge into the latest version and keep untouched frames."
        : "Review the suggested frame replacements before uploading.");
      setBusy(false);
      return;
    }
    await finishUpload([]);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The snapshot could not be uploaded.", "error");
    setBusy(false);
  }
}

captureButton.addEventListener("click", () => {
  currentCapture = null;
  overviewBytes = null;
  overviewWidth = 0;
  overviewHeight = 0;
  pendingUpload = null;
  replacementReview.hidden = true;
  replacementList.replaceChildren();
  uploadButton.hidden = false;
  uploadButton.disabled = true;
  result.hidden = true;
  summary.textContent = "";
  preview.width = 1;
  preview.height = 1;
  setBusy(true);
  setStatus("Reading the Figma canvas…");
  pluginMessage({ type: "capture", scope: scopeInput.value });
});

uploadButton.addEventListener("click", () => { void uploadCapture(); });
confirmReplacementsButton.addEventListener("click", () => { void finishUpload(selectedFrameMatches()); });
skipReplacementsButton.addEventListener("click", () => { void finishUpload([]); });

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
  currentCapture = data;
  setStatus("Preparing the Figma-rendered overview and inspectable layer data…");
  void Promise.resolve().then(async () => {
    const overview = await createOverviewPng(data);
    const renders = await Promise.all(data.renders.map(cropFrameRender));
    currentCapture = { ...data, renders };
    return { overview, data };
  }).then(async ({ overview, data: capture }) => {
    const { bytes, width, height } = overview;
    overviewBytes = bytes;
    overviewWidth = width;
    overviewHeight = height;
    preview.width = width;
    preview.height = height;
    const context = preview.getContext("2d", { alpha: true });
    if (!context) throw new Error("The browser could not create the canvas preview.");
    const pixelPreview = await loadImage(bytes, "image/png");
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(pixelPreview, 0, 0, preview.width, preview.height);
    const nodeCount = capture.payload.frames.reduce((count, frame) => count + frame.nodes.length, 0);
    const frameCount = capture.payload.frames.length;
    const pageCount = Array.isArray(capture.payload.sourceMetadata.pageLayout)
      ? capture.payload.sourceMetadata.pageLayout.length
      : 0;
    const renderScale = capture.payload.sourceMetadata.renderScale === 2 ? "2×" : "1×";
    const vectorSourceCount = capture.vectorRenders.length;
    const layerExportCount = capture.layerRenders.length;
    const fallbackFrameIds = Array.isArray(capture.payload.sourceMetadata.renderScaleFallbackFrameIds)
      ? capture.payload.sourceMetadata.renderScaleFallbackFrameIds.filter((frameId): frameId is string => typeof frameId === "string")
      : [];
    const vectorSummary = vectorSourceCount === frameCount
      ? "SVG sources retained"
      : `${vectorSourceCount}/${frameCount} SVG sources retained`;
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
    const layerExportSummary = layerExportCount ? ` · ${layerExportCount} layers ready to export` : "";
    const pageSummary = capture.scope === "file" ? ` · ${pageCount} pages` : "";
    const captureScopeSummary = formatFigmaCaptureScope(capture.scope);
    const scopeSummary = captureScopeSummary ? `Capture scope: ${captureScopeSummary} · ` : "";
    summary.textContent = `${scopeSummary}${frameCount} frame${frameCount === 1 ? "" : "s"}${pageSummary} · ${nodeCount.toLocaleString()} layers · ${width} × ${height} px overview · ${scaleSummary} · ${vectorSummary}${layerExportSummary}${warningSummary}${duplicateNameSummary}`;
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
    ].filter(Boolean).join(" ")
      || "Review the Figma-rendered preview and layer count, then upload this snapshot.";
    setStatus(statusMessage, duplicateFrameNames.length || blankFrameNameCount || capture.warnings.length ? "warning" : "plain");
    setBusy(false);
  }).catch((error: unknown) => {
    currentCapture = null;
    overviewBytes = null;
    setStatus(error instanceof Error ? error.message : "The canvas overview could not be prepared.", "error");
    setBusy(false);
  });
};

setBusy(false);
setStatus("Connect with the one-time token from a Handoff project.");
