import { createHash } from "node:crypto";
import { unzip, type Unzipped } from "fflate";
import { z } from "zod";
import {
  hashSnapshotPayload,
  snapshotEnvelopeSchema,
  type SnapshotEnvelope,
  type VisualOnlySnapshot,
} from "@asbir/snapshot-contract";
import type { VersionAssetInput } from "../repositories/versions";

export const MAX_UPLOAD_BYTES = 100_000_000;
const MAX_ZIP_ENTRIES = 2048;
const MAX_MANIFEST_BYTES = 1_000_000;

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.literal("bundle"),
    snapshotFile: z.literal("snapshot.json").default("snapshot.json"),
  })
  .passthrough();

type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compression: number;
};

export class SnapshotImportError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415) {
    super(message);
    this.name = "SnapshotImportError";
  }
}

function safeZipPath(name: string) {
  if (
    name.length === 0 ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name)
  ) {
    throw new SnapshotImportError("The ZIP contains an unsafe file path.", 400);
  }

  const segments = name.split("/").filter((segment) => segment.length > 0);
  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment === "__proto__" ||
        segment === "constructor" ||
        segment === "prototype",
    )
  ) {
    throw new SnapshotImportError("The ZIP contains an unsafe file path.", 400);
  }

  return segments.join("/");
}

function inspectZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new SnapshotImportError("The ZIP is larger than 100 MB.", 413);
  }
  if (bytes.byteLength < 22) {
    throw new SnapshotImportError("The uploaded file is not a valid ZIP package.", 400);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.byteLength - 22 - 65_535);
  let endRecordOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endRecordOffset = offset;
      break;
    }
  }
  if (endRecordOffset < 0) {
    throw new SnapshotImportError("The ZIP package is missing its directory record.", 400);
  }

  const diskNumber = view.getUint16(endRecordOffset + 4, true);
  const directoryDisk = view.getUint16(endRecordOffset + 6, true);
  const entriesOnDisk = view.getUint16(endRecordOffset + 8, true);
  const entryCount = view.getUint16(endRecordOffset + 10, true);
  const directorySize = view.getUint32(endRecordOffset + 12, true);
  const directoryOffset = view.getUint32(endRecordOffset + 16, true);

  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new SnapshotImportError("Multi-disk ZIP packages are not supported.", 400);
  }
  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new SnapshotImportError("ZIP64 packages are not supported.", 400);
  }
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new SnapshotImportError("The ZIP contains too many files.", 400);
  }
  if (
    directoryOffset + directorySize > endRecordOffset ||
    directoryOffset + directorySize > bytes.byteLength
  ) {
    throw new SnapshotImportError("The ZIP directory is invalid.", 400);
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names = new Set<string>();
  const entries: ZipEntry[] = [];
  let totalExpandedBytes = 0;
  let offset = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directoryOffset + directorySize || view.getUint32(offset, true) !== 0x02014b50) {
      throw new SnapshotImportError("The ZIP directory contains an invalid file entry.", 400);
    }

    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const recordLength = 46 + fileNameLength + extraLength + commentLength;

    if (offset + recordLength > directoryOffset + directorySize) {
      throw new SnapshotImportError("The ZIP directory contains a truncated entry.", 400);
    }
    if (flags & 0x1) {
      throw new SnapshotImportError("Password-protected ZIP packages are not supported.", 400);
    }
    if (compression !== 0 && compression !== 8) {
      throw new SnapshotImportError("The ZIP uses an unsupported compression method.", 400);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new SnapshotImportError("ZIP64 packages are not supported.", 400);
    }

    let name: string;
    try {
      name = decoder.decode(
        bytes.subarray(offset + 46, offset + 46 + fileNameLength),
      );
    } catch {
      throw new SnapshotImportError("The ZIP contains a file name that is not valid UTF-8.", 400);
    }
    const normalizedName = safeZipPath(name);
    const isDirectory = name.endsWith("/");

    if (!isDirectory) {
      if (names.has(normalizedName)) {
        throw new SnapshotImportError(`The ZIP contains a duplicate path: ${normalizedName}.`, 400);
      }
      names.add(normalizedName);

      totalExpandedBytes += uncompressedSize;
      if (uncompressedSize > MAX_UPLOAD_BYTES || totalExpandedBytes > MAX_UPLOAD_BYTES) {
        throw new SnapshotImportError("Expanded ZIP contents exceed 100 MB.", 413);
      }
      if (uncompressedSize > 0 && compressedSize === 0) {
        throw new SnapshotImportError("The ZIP contains an invalid compressed file.", 400);
      }
      if (compressedSize > 0 && uncompressedSize / compressedSize > 1000) {
        throw new SnapshotImportError("A ZIP entry has an unsafe compression ratio.", 400);
      }

      entries.push({ name: normalizedName, compressedSize, uncompressedSize, compression });
    }

    offset += recordLength;
  }

  if (offset !== directoryOffset + directorySize) {
    throw new SnapshotImportError("The ZIP directory size does not match its entries.", 400);
  }

  return entries;
}

async function expandZip(bytes: Uint8Array, entryNames: Set<string>) {
  return new Promise<Unzipped>((resolve, reject) => {
    unzip(
      bytes,
      { filter: (entry) => entryNames.has(entry.name) },
      (error, files) => {
        if (error) reject(error);
        else resolve(files);
      },
    );
  });
}

function expectedImageType(fileName: string) {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return null;
}

function verifySvgBytes(bytes: Uint8Array, fileName: string) {
  let markup: string;
  try {
    markup = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SnapshotImportError(`The file "${fileName}" is not valid UTF-8 SVG.`, 415);
  }
  if (!/^\s*(?:<\?xml\s+[^?]*\?>\s*)?<svg\b/i.test(markup)) {
    throw new SnapshotImportError(`The file "${fileName}" is not a valid SVG render.`, 415);
  }
  if (/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed)\b|javascript\s*:|@import\b/i.test(markup)) {
    throw new SnapshotImportError(`The SVG render "${fileName}" contains unsupported active content.`, 415);
  }
  if (/\son[a-z]+\s*=/i.test(markup)) {
    throw new SnapshotImportError(`The SVG render "${fileName}" contains an unsupported event handler.`, 415);
  }
  const hrefPattern = /(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi;
  for (const match of markup.matchAll(hrefPattern)) {
    const value = match[2].trim();
    if (!value.startsWith("#") && !/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/i.test(value)) {
      throw new SnapshotImportError(`The SVG render "${fileName}" references an external resource.`, 415);
    }
  }
  const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  for (const match of markup.matchAll(urlPattern)) {
    const value = match[2].trim();
    if (!value.startsWith("#") && !/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/i.test(value)) {
      throw new SnapshotImportError(`The SVG render "${fileName}" references an external resource.`, 415);
    }
  }

  const root = markup.match(/<svg\b([^>]*)>/i)?.[1];
  if (!root) throw new SnapshotImportError(`The file "${fileName}" is not a valid SVG render.`, 415);
  const attribute = (name: string) => root.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? null;
  const viewBox = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const dimension = (name: string, fallback?: number) => {
    const value = attribute(name);
    const parsed = value ? Number.parseFloat(value) : Number.NaN;
    const number = Number.isFinite(parsed) ? parsed : fallback;
    return typeof number === "number" && number > 0 && number <= 1_000_000 ? Math.round(number) : null;
  };
  const width = dimension("width", viewBox?.[2]);
  const height = dimension("height", viewBox?.[3]);
  if (!width || !height) {
    throw new SnapshotImportError(`The SVG render "${fileName}" must declare a finite width and height.`, 415);
  }
  return { width, height };
}

export function verifyRenderAssetBytes(bytes: Uint8Array, contentType: string, fileName: string) {
  if (expectedImageType(fileName) !== contentType) {
    throw new SnapshotImportError(`Unsupported image type for "${fileName}".`, 415);
  }
  if (contentType === "image/svg+xml") return verifySvgBytes(bytes, fileName);

  const isPng =
    contentType === "image/png" &&
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg =
    contentType === "image/jpeg" &&
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isWebp =
    contentType === "image/webp" &&
    bytes.byteLength >= 12 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";

  if (!isPng && !isJpeg && !isWebp) {
    throw new SnapshotImportError(`The file "${fileName}" is not a valid ${contentType} image.`, 415);
  }

  if (isPng) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }

  if (isJpeg) {
    let offset = 2;
    while (offset + 4 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > bytes.byteLength) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
      const isFrameHeader = [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
      ].includes(marker);
      if (isFrameHeader && segmentLength >= 7) {
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      offset += segmentLength;
    }
  }

  if (isWebp) {
    const chunkType = new TextDecoder().decode(bytes.subarray(12, 16));
    if (chunkType === "VP8X" && bytes.byteLength >= 30) {
      const read24 = (index: number) => bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16);
      return { width: read24(24) + 1, height: read24(27) + 1 };
    }
    if (chunkType === "VP8L" && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
      return { width, height };
    }
    if (chunkType === "VP8 " && bytes.byteLength >= 30) {
      return {
        width: ((bytes[26] | (bytes[27] << 8)) & 0x3fff) || undefined,
        height: ((bytes[28] | (bytes[29] << 8)) & 0x3fff) || undefined,
      };
    }
  }

  return undefined;
}

function assetHash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function importSnapshotPackage(bytes: Uint8Array) {
  const entries = inspectZip(bytes);
  const entryNames = new Set(entries.map((entry) => entry.name));
  if (!entryNames.has("manifest.json") || !entryNames.has("snapshot.json")) {
    throw new SnapshotImportError("A snapshot package must contain manifest.json and snapshot.json.", 400);
  }

  const files = await expandZip(bytes, entryNames);
  for (const entry of entries) {
    if (!files[entry.name] || files[entry.name].byteLength !== entry.uncompressedSize) {
      throw new SnapshotImportError(`The ZIP entry "${entry.name}" could not be read completely.`, 400);
    }
  }

  const manifestBytes = files["manifest.json"];
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new SnapshotImportError("manifest.json must be smaller than 1 MB.", 400);
  }

  let manifestValue: unknown;
  let snapshotValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
    snapshotValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files["snapshot.json"]));
  } catch {
    throw new SnapshotImportError("The package manifest or snapshot JSON is invalid.", 400);
  }

  const manifestResult = manifestSchema.safeParse(manifestValue);
  if (!manifestResult.success) {
    throw new SnapshotImportError("manifest.json must use schema version 1 and source bundle.", 400);
  }
  if (manifestResult.data.snapshotFile !== "snapshot.json") {
    throw new SnapshotImportError("The manifest must point to snapshot.json.", 400);
  }

  const snapshotResult = snapshotEnvelopeSchema.safeParse(snapshotValue);
  if (!snapshotResult.success) {
    throw new SnapshotImportError("snapshot.json does not match the supported snapshot schema.", 400);
  }
  const originalSnapshot = snapshotResult.data;
  if (originalSnapshot.source !== "bundle") {
    throw new SnapshotImportError("Package snapshots must use source bundle.", 400);
  }
  const originalHash = await hashSnapshotPayload(originalSnapshot);
  if (originalHash !== originalSnapshot.contentHash) {
    throw new SnapshotImportError("snapshot.json content hash does not match its content.", 400);
  }

  const referencedFiles = new Set(["manifest.json", "snapshot.json"]);
  const assets: VersionAssetInput[] = originalSnapshot.assets.map((asset) => {
    let fileName: string;
    try {
      fileName = safeZipPath(asset.fileName);
    } catch {
      throw new SnapshotImportError(`Asset "${asset.key}" has an unsafe file path.`, 400);
    }

    if (!entryNames.has(fileName) || referencedFiles.has(fileName)) {
      throw new SnapshotImportError(`Asset file "${fileName}" is missing or duplicated.`, 400);
    }
    referencedFiles.add(fileName);

    const assetBytes = files[fileName];
    if (!assetBytes) throw new SnapshotImportError(`Asset file "${fileName}" is missing.`, 400);
    const dimensions = verifyRenderAssetBytes(assetBytes, asset.contentType, fileName);

    if (asset.sizeBytes !== assetBytes.byteLength || asset.sha256 !== assetHash(assetBytes)) {
      throw new SnapshotImportError(`Asset checksum or size does not match for "${fileName}".`, 400);
    }
    if (
      dimensions &&
      ((asset.width !== undefined && asset.width !== dimensions.width) ||
        (asset.height !== undefined && asset.height !== dimensions.height))
    ) {
      throw new SnapshotImportError(`Asset dimensions do not match for "${fileName}".`, 400);
    }

    return {
      ...asset,
      fileName,
      width: asset.width ?? dimensions?.width,
      height: asset.height ?? dimensions?.height,
      bytes: assetBytes,
    };
  });

  if (referencedFiles.size !== entryNames.size) {
    const unreferenced = [...entryNames].find((entryName) => !referencedFiles.has(entryName));
    throw new SnapshotImportError(`The ZIP contains an unreferenced file: ${unreferenced}.`, 400);
  }

  const snapshotWithManifest = snapshotEnvelopeSchema.parse({
    ...originalSnapshot,
    sourceMetadata: {
      ...originalSnapshot.sourceMetadata,
      packageManifest: JSON.parse(JSON.stringify(manifestResult.data)) as unknown,
    },
  });
  const contentHash = await hashSnapshotPayload(snapshotWithManifest);
  const snapshot: SnapshotEnvelope = { ...snapshotWithManifest, contentHash };

  return { snapshot, assets, visualOnly: false as const };
}

export async function importImageOnly(file: File) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new SnapshotImportError("The image is larger than 100 MB.", 413);
  }
  if (file.size === 0) {
    throw new SnapshotImportError("The image file is empty.", 400);
  }

  const fileName = file.name.split(/[\\/]/).at(-1)?.trim() || "design-snapshot";
  const contentType = expectedImageType(fileName);
  if (!contentType) {
    throw new SnapshotImportError("Upload a PNG, JPEG, WebP, or SVG render.", 415);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = verifyRenderAssetBytes(bytes, contentType, fileName);

  const assetKey = "overview";
  const asset: VersionAssetInput = {
    key: assetKey,
    fileName,
    contentType,
    sizeBytes: bytes.byteLength,
    sha256: assetHash(bytes),
    width: dimensions?.width,
    height: dimensions?.height,
    bytes,
  };

  const snapshotWithoutHash: Omit<VisualOnlySnapshot, "contentHash"> = {
    schemaVersion: 1,
    source: "bundle",
    sourceFileId: "image-upload",
    sourceRevisionId: null,
    sourceFileName: fileName,
    capturedAt: new Date().toISOString(),
    visualOnly: true,
    overviewAssetKey: assetKey,
    frames: [
      {
        sourceFrameId: "image-upload-frame",
        name: fileName,
        renderAssetKey: assetKey,
      },
    ],
    assets: [
      {
        key: assetKey,
        fileName,
        contentType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        width: asset.width,
        height: asset.height,
      },
    ],
    sourceMetadata: { importMethod: "image-only" },
  };
  const contentHash = await hashSnapshotPayload({
    ...snapshotWithoutHash,
    contentHash: "0".repeat(64),
  });
  const snapshot: VisualOnlySnapshot = { ...snapshotWithoutHash, contentHash };

  return { snapshot, assets: [asset], visualOnly: true as const };
}

export async function readRequestBodyLimited(request: Request, maximumBytes: number) {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new SnapshotImportError("The upload request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

export async function parseUploadForm(
  request: Request,
  maximumRequestBytes = MAX_UPLOAD_BYTES + 2_000_000,
) {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > maximumRequestBytes) {
    throw new SnapshotImportError("The upload request is too large.", 413);
  }

  const body = await readRequestBodyLimited(request, maximumRequestBytes);
  const clonedRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
  });

  try {
    return await clonedRequest.formData();
  } catch {
    throw new SnapshotImportError("The upload form could not be read.", 400);
  }
}
