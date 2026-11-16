import type { Bounds, SnapshotPayload } from "@asbir/snapshot-contract";

export type DraftSnapshot = Omit<SnapshotPayload, "assets" | "overviewAssetKey" | "canvasBounds"> & {
  canvasBounds: Bounds;
};

export interface CaptureAssetBytes {
  key: string;
  fileName: string;
  contentType: "image/png" | "image/svg+xml";
  bytes: Uint8Array;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Full Figma render bounds before the frame image is cropped for review. */
  renderBounds?: { x: number; y: number; width: number; height: number };
}

export interface LayerExportAssetBytes extends CaptureAssetBytes {
  sourceFrameId: string;
  sourceNodeId: string;
  sourceFrameName: string;
  sourceLayerName: string;
}

export type LayerAssetMode = "recommended" | "raster" | "none";

export interface LayerAssetFrameReport {
  sourceFrameId: string;
  frameName: string;
  eligibleCount: number;
  modeSkippedCount: number;
  candidateCount: number;
  limitSkippedCount: number;
  selectedCount: number;
  exportedCount: number;
  exportFailureCount: number;
  sizeSkippedCount: number;
  fallbackCount: number;
}

export interface LayerAssetReport extends Omit<LayerAssetFrameReport, "sourceFrameId" | "frameName"> {
  mode: LayerAssetMode;
  limit: number;
  frames: LayerAssetFrameReport[];
}

export interface ExcludedSectionCount {
  name: string;
  frameCount: number;
}

export interface CaptureReadyMessage {
  type: "capture-ready";
  payload: DraftSnapshot;
  /** Pixel renders used by the overview and review canvas. */
  renders: CaptureAssetBytes[];
  /** SVG source retained separately from the Figma-accurate pixel render. */
  vectorRenders: CaptureAssetBytes[];
  /** Optional exports for individual vector and image layers. */
  layerRenders: LayerExportAssetBytes[];
  /** Counts describing eligible, exported, and skipped individual layer assets. */
  layerAssetReport: LayerAssetReport;
  /** Optional Figma lookups that could not be read without blocking the frame capture. */
  warnings: string[];
  scope: "selected" | "page" | "file";
  /** Whether the capture included all current-page roots in selected merge mode. */
  captureAllTopLevel: boolean;
  /** Top-level Figma sections omitted from a current-page capture. */
  excludedTopLevelSections: string[];
  /** Frame counts omitted under each configured top-level section. */
  excludedSectionCounts: ExcludedSectionCount[];
}

export interface CaptureProgressMessage {
  type: "capture-progress";
  message: string;
}

export interface CaptureErrorMessage {
  type: "capture-error";
  message: string;
}
