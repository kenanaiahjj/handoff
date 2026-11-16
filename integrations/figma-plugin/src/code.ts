import { captureFigmaCanvas } from "./capture";
import type { CaptureErrorMessage, CaptureProgressMessage, CaptureReadyMessage } from "./types";

figma.showUI(__html__, { width: 430, height: 720, themeColors: true });

figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== "object") return;
  const data = message as { type?: unknown; scope?: unknown; captureAllTopLevel?: unknown; excludedTopLevelSections?: unknown; layerAssetMode?: unknown };
  if (data.type !== "capture" || (data.scope !== "selected" && data.scope !== "page" && data.scope !== "file")) return;
  const scope = data.scope;
  const captureAllTopLevel = data.captureAllTopLevel === true;
  const layerAssetMode = data.layerAssetMode === "raster" || data.layerAssetMode === "none" ? data.layerAssetMode : "recommended";
  const excludedTopLevelSections = scope === "page" && Array.isArray(data.excludedTopLevelSections)
    ? [...new Set(data.excludedTopLevelSections.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean))]
    : scope === "selected" && captureAllTopLevel && Array.isArray(data.excludedTopLevelSections)
      ? [...new Set(data.excludedTopLevelSections.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean))]
    : [];
  try {
    const result = await captureFigmaCanvas(scope, (status) => {
      const progress: CaptureProgressMessage = { type: "capture-progress", message: status };
      figma.ui.postMessage(progress);
    }, excludedTopLevelSections, captureAllTopLevel, layerAssetMode);
    const ready: CaptureReadyMessage = { type: "capture-ready", ...result, scope, captureAllTopLevel, excludedTopLevelSections };
    figma.ui.postMessage(ready);
  } catch (error) {
    const failure: CaptureErrorMessage = {
      type: "capture-error",
      message: error instanceof Error ? error.message : "Figma could not capture this canvas.",
    };
    figma.ui.postMessage(failure);
  }
};
