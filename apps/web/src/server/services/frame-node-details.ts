import type { SnapshotEnvelope } from "@asbir/snapshot-contract";
import type { getVersion } from "../repositories/versions";

/** Full captured elements for one screen, loaded when someone inspects it. */
export function frameNodeDetails(version: NonNullable<Awaited<ReturnType<typeof getVersion>>>, frameId: string) {
  if (version.visualOnly) return [];
  const frame = (version.snapshot as SnapshotEnvelope).frames.find((candidate) => candidate.sourceFrameId === frameId);
  return frame ? frame.nodes : null;
}

/** Versions never change, so a screen's details can be cached by the browser for a long time. */
export const frameNodeDetailsHeaders = { "Cache-Control": "private, max-age=31536000, immutable" };
