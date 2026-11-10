import { sha256 } from "@noble/hashes/sha2.js";
import type {
  SnapshotEnvelope,
  SnapshotPayload,
  VisualOnlySnapshot,
} from "./schema";

const utf8 = new TextEncoder();
const maxChunkLength = 16 * 1024;

type CanonicalTask = { kind: "value"; value: unknown } | { kind: "text"; value: string };

export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function writeCanonicalJson(value: unknown) {
  const hash = sha256.create();
  const writeText = (text: string) => hash.update(utf8.encode(text));
  const writeString = (value: string) => {
    writeText('"');
    let chunkStart = 0;
    let index = 0;
    while (index < value.length) {
      const codeUnit = value.charCodeAt(index);
      let escape: string | null = null;
      let nextIndex = index + 1;
      if (codeUnit === 0x22) escape = '\\"';
      else if (codeUnit === 0x5c) escape = "\\\\";
      else if (codeUnit === 0x08) escape = "\\b";
      else if (codeUnit === 0x09) escape = "\\t";
      else if (codeUnit === 0x0a) escape = "\\n";
      else if (codeUnit === 0x0c) escape = "\\f";
      else if (codeUnit === 0x0d) escape = "\\r";
      else if (codeUnit < 0x20) escape = `\\u${codeUnit.toString(16).padStart(4, "0")}`;
      else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) nextIndex = index + 2;
        else escape = `\\u${codeUnit.toString(16).padStart(4, "0")}`;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        escape = `\\u${codeUnit.toString(16).padStart(4, "0")}`;
      }

      if (escape !== null) {
        if (index > chunkStart) writeText(value.slice(chunkStart, index));
        writeText(escape);
        index = nextIndex;
        chunkStart = index;
        continue;
      }

      index = nextIndex;
      if (index - chunkStart >= maxChunkLength) {
        writeText(value.slice(chunkStart, index));
        chunkStart = index;
      }
    }
    if (chunkStart < value.length) writeText(value.slice(chunkStart));
    writeText('"');
  };

  const stack: CanonicalTask[] = [{ kind: "value", value }];
  while (stack.length) {
    const task = stack.pop()!;
    if (task.kind === "text") {
      writeText(task.value);
      continue;
    }

    const current = task.value;
    if (current === null) {
      writeText("null");
    } else if (typeof current === "string") {
      writeString(current);
    } else if (typeof current === "boolean") {
      writeText(current ? "true" : "false");
    } else if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("Snapshot payloads can only hash finite numbers.");
      writeText(JSON.stringify(current));
    } else if (Array.isArray(current)) {
      stack.push({ kind: "text", value: "]" });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ kind: "value", value: current[index] });
        if (index > 0) stack.push({ kind: "text", value: "," });
      }
      stack.push({ kind: "text", value: "[" });
    } else if (typeof current === "object") {
      const entries = Object.entries(current as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      stack.push({ kind: "text", value: "}" });
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, entry] = entries[index];
        stack.push({ kind: "value", value: entry });
        stack.push({ kind: "text", value: ":" });
        stack.push({ kind: "value", value: key });
        if (index > 0) stack.push({ kind: "text", value: "," });
      }
      stack.push({ kind: "text", value: "{" });
    } else {
      throw new TypeError("Snapshot payloads must contain JSON-compatible values.");
    }
  }

  return hash.digest();
}

export async function hashSnapshotPayload(
  payload: SnapshotPayload | SnapshotEnvelope | VisualOnlySnapshot,
): Promise<string> {
  const { contentHash: _contentHash, ...payloadWithoutHash } = payload as
    | SnapshotEnvelope
    | VisualOnlySnapshot;
  return Array.from(writeCanonicalJson(payloadWithoutHash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
