import { captureFigmaCanvas } from "./capture";
import type { CaptureErrorMessage, CaptureProgressMessage, CaptureReadyMessage } from "./types";

figma.showUI(__html__, { width: 430, height: 720, themeColors: true });

figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== "object") return;
  const data = message as { type?: unknown; scope?: unknown };
  if (data.type !== "capture" || (data.scope !== "selected" && data.scope !== "page" && data.scope !== "file")) return;
  const scope = data.scope;
  try {
    const result = await captureFigmaCanvas(scope, (status) => {
      const progress: CaptureProgressMessage = { type: "capture-progress", message: status };
      figma.ui.postMessage(progress);
    });
    const ready: CaptureReadyMessage = { type: "capture-ready", ...result, scope };
    figma.ui.postMessage(ready);
  } catch (error) {
    const failure: CaptureErrorMessage = {
      type: "capture-error",
      message: error instanceof Error ? error.message : "Figma could not capture this canvas.",
    };
    figma.ui.postMessage(failure);
  }
};
