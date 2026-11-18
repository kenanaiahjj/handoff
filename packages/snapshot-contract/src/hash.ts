import { sha256 } from "@noble/hashes/sha2.js";
import type {
  SnapshotEnvelope,
  SnapshotPayload,
  VisualOnlySnapshot,
} from "./schema";

const utf8 = typeof TextEncoder === "undefined" ? null : new TextEncoder();
const maxChunkLength = 16 * 1024;

function encodeUtf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes = new Uint8Array(encoded.length);
  let length = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded.charCodeAt(index) === 0x25) {
      bytes[length] = Number.parseInt(encoded.slice(index + 1, index + 3), 16);
      index += 2;
    } else {
      bytes[length] = encoded.charCodeAt(index);
    }
    length += 1;
  }
  return bytes.subarray(0, length);
}

export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Text is hashed in blocks this size: one update per token made a large capture take ~13 s to hash. */
const hashBufferLength = 16 * 1024;

type IncrementalHash = { update(text: string): void; digest(): Uint8Array };

type NodeCrypto = { createHash(algorithm: "sha256"): { update(data: string, encoding: "utf8"): unknown; digest(): Uint8Array } };

/**
 * Node's native SHA-256 when it is available (the server: ~4x faster on a 250 MB capture), otherwise
 * the portable implementation (the Figma plugin sandbox has no Node built-ins). Both hash the same
 * UTF-8 bytes, so they produce the same digest. getBuiltinModule keeps node:crypto out of the plugin bundle.
 */
function createIncrementalHash(): IncrementalHash {
  const nodeProcess = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const nodeCrypto = nodeProcess?.getBuiltinModule?.("node:crypto") as NodeCrypto | undefined;
  if (nodeCrypto) {
    const hash = nodeCrypto.createHash("sha256");
    return { update: (text) => void hash.update(text, "utf8"), digest: () => new Uint8Array(hash.digest()) };
  }
  const hash = sha256.create();
  return { update: (text) => void hash.update(utf8 ? utf8.encode(text) : encodeUtf8(text)), digest: () => hash.digest() };
}

function writeCanonicalJson(value: unknown) {
  const hash = createIncrementalHash();
  // Same bytes as hashing each piece separately, so the hash is unchanged. Pieces never end inside a
  // surrogate pair (writeString keeps pairs together), so joining them never splits a character.
  let pending = "";
  const flush = () => {
    if (!pending) return;
    hash.update(pending);
    pending = "";
  };
  // Never encode more than hashBufferLength characters at once (keeps memory flat inside Figma).
  const writeText = (text: string) => {
    if (pending.length + text.length > hashBufferLength) flush();
    if (text.length >= hashBufferLength) hash.update(text);
    else pending += text;
  };
  // JSON.stringify escapes strings exactly as canonical JSON requires (quote, backslash, \b \f \n \r \t,
  // other control characters and lone surrogates as lowercase \u00xx), natively instead of per character.
  const writeString = (value: string) => {
    if (value.length <= hashBufferLength) {
      writeText(JSON.stringify(value));
      return;
    }
    // Very long strings are escaped in slices that never split a surrogate pair, so memory stays bounded.
    writeText('"');
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + maxChunkLength, value.length);
      const last = value.charCodeAt(end - 1);
      if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
      const escaped = JSON.stringify(value.slice(start, end));
      writeText(escaped.slice(1, -1));
      start = end;
    }
    writeText('"');
  };

  // Snapshot JSON is shallow (screens hold a flat list of layers), so plain recursion is safe; the
  // depth cap turns a hostile, deeply nested payload into an error instead of a stack overflow.
  const maxDepth = 2_000;
  const writeValue = (current: unknown, depth: number): void => {
    if (depth > maxDepth) throw new TypeError("Snapshot payloads are nested too deeply to hash.");
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
      writeText("[");
      for (let index = 0; index < current.length; index += 1) {
        if (index > 0) writeText(",");
        writeValue(current[index], depth + 1);
      }
      writeText("]");
    } else if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      // Default sort orders by UTF-16 code units, the same order as comparing keys with < and >.
      const keys = Object.keys(record).sort();
      writeText("{");
      let first = true;
      for (const key of keys) {
        const entry = record[key];
        if (entry === undefined) continue;
        if (!first) writeText(",");
        first = false;
        writeString(key);
        writeText(":");
        writeValue(entry, depth + 1);
      }
      writeText("}");
    } else {
      throw new TypeError("Snapshot payloads must contain JSON-compatible values.");
    }
  };
  writeValue(value, 0);

  flush();
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
