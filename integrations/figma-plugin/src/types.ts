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
}

export interface LayerExportAssetBytes extends CaptureAssetBytes {
  sourceFrameId: string;
  sourceNodeId: string;
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
  /** Optional Figma lookups that could not be read without blocking the frame capture. */
  warnings: string[];
  scope: "selected" | "page";
}

export interface CaptureProgressMessage {
  type: "capture-progress";
  message: string;
}

export interface CaptureErrorMessage {
  type: "capture-error";
  message: string;
}
