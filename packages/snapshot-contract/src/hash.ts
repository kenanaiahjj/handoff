import { sha256 } from "@noble/hashes/sha2.js";
import type {
  SnapshotEnvelope,
  SnapshotPayload,
  VisualOnlySnapshot,
} from "./schema";
import { encodeUtf8 } from "./utf8";

export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Snapshot payloads can only hash finite numbers.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }

  throw new TypeError("Snapshot payloads must contain JSON-compatible values.");
}

export async function hashSnapshotPayload(
  payload: SnapshotPayload | SnapshotEnvelope | VisualOnlySnapshot,
): Promise<string> {
  const { contentHash: _contentHash, ...payloadWithoutHash } = payload as
    | SnapshotEnvelope
    | VisualOnlySnapshot;
  const canonicalJson = canonicalize(payloadWithoutHash);
  return sha256Hex(encodeUtf8(canonicalJson));
}
