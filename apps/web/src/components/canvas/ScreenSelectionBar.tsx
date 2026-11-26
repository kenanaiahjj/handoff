"use client";

import { useState } from "react";
import { showToast } from "@/src/components/shell/Toaster";
import type { CanvasFrameOption } from "./FrameNavigator";
import { download, safeName } from "./InspectorExport";
import { screenExportFileNames, screenLinkLines } from "./screen-bulk-export";
import { copyScreensImage } from "./screen-image";

async function fetchImage(screen: CanvasFrameOption) {
  const response = await fetch(screen.imageSrc, { cache: "no-store" });
  if (!response.ok) throw new Error(`“${screen.name}” could not be loaded.`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Floats above the canvas toolbar while screens are picked with the Select tool: export them all at
 * once (their captured images, zipped) or copy a link to each for a ticket.
 */
export function ScreenSelectionBar({ screens, allScreens, zipName, onClear }: {
  /** The selected screens, in page order. */
  screens: CanvasFrameOption[];
  allScreens: CanvasFrameOption[];
  zipName: string;
  onClear: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const count = screens.length;
  const label = `${count} ${count === 1 ? "screen" : "screens"}`;

  async function exportScreens() {
    setExporting(true);
    try {
      const names = screenExportFileNames(screens);
      const files = await Promise.all(screens.map(fetchImage));
      if (count === 1) {
        download(new Blob([files[0]]), names[0]);
      } else {
        // Images are already compressed, so store them as they are; loaded only when someone exports.
        const { zipSync } = await import("fflate");
        const zip = zipSync(Object.fromEntries(names.map((name, index) => [name, [files[index], { level: 0 }]])));
        download(new Blob([zip], { type: "application/zip" }), `${safeName(zipName)}.zip`);
      }
      showToast(`Exported ${label}`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "The screens could not be exported.", "error");
    } finally {
      setExporting(false);
    }
  }

  function copyLinks() {
    const text = screenLinkLines(screens, window.location.href);
    navigator.clipboard?.writeText(text).then(
      () => showToast(`Copied links to ${label}`),
      () => showToast("Couldn’t copy the links", "error"),
    );
  }

  return (
    <div aria-label="Selected screens" className="canvas-floatbar canvas-selectionbar" role="toolbar">
      <span aria-live="polite" className="whitespace-nowrap px-2 text-[12px] font-medium text-foreground">{label} selected</span>
      <span aria-hidden="true" className="canvas-floatbar-divider" />
      <button className="canvas-tool" disabled={exporting} onClick={exportScreens} title={count === 1 ? "Download this screen’s image" : "Download the selected screens’ images as a zip"} type="button">
        {exporting ? "Exporting…" : "Export"}
      </button>
      <button className="canvas-tool" onClick={() => void copyScreensImage(screens, allScreens)} title={count === 1 ? "Copy this screen as an image (⌘C)" : "Copy the selected screens side by side as one image (⌘C)"} type="button">
        Copy image
      </button>
      <button className="canvas-tool" onClick={copyLinks} title="Copy a link to each selected screen" type="button">
        Copy links
      </button>
      <button aria-label="Clear selection" className="canvas-tool canvas-tool-icon" onClick={onClear} title="Clear selection (Esc)" type="button">
        <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  );
}
