import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDirectory } from "../db";
import type { ObjectStore } from "./object-store";

const objectKeyPattern = /^[a-f0-9]{48}$/;
const uploadTokenLifetimeMs = 10 * 60 * 1000;

function localStorageSecret() {
  const secret = process.env.ASBIR_LOCAL_STORAGE_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error("A local-only Storage signing secret must be set.");
  return secret;
}

function tokenSignature(purpose: "upload" | "download", key: string, expiresAt: number) {
  return createHmac("sha256", localStorageSecret())
    .update(`${purpose}\0${key}\0${expiresAt}`)
    .digest("base64url");
}

function createLocalObjectToken(purpose: "upload" | "download", key: string, expiresAt: number) {
  return `${expiresAt}.${tokenSignature(purpose, key, expiresAt)}`;
}

export function verifyLocalObjectToken(
  purpose: "upload" | "download",
  key: string,
  token: string,
  now = Date.now(),
) {
  if (!objectKeyPattern.test(key)) return false;
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  try {
    const expected = Buffer.from(tokenSignature(purpose, key, expiresAt));
    const received = Buffer.from(match[2]);
    return expected.byteLength === received.byteLength && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

function localStorageOrigin() {
  return new URL(process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000").origin;
}

function bucketName() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "handoff-assets";
}

export class LocalObjectStore implements ObjectStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory = path.join(getDataDirectory(), "objects")) {
    this.rootDirectory = path.resolve(/* turbopackIgnore: true */ rootDirectory);
  }

  private resolveKey(key: string) {
    if (!objectKeyPattern.test(key)) {
      throw new TypeError("Object keys must be 48 lowercase hexadecimal characters.");
    }

    const destination = path.resolve(this.rootDirectory, key);
    const relativePath = path.relative(this.rootDirectory, destination);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new TypeError("Object key resolves outside the object store.");
    }

    return destination;
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    const objectPath = this.resolveKey(key);
    const metadataPath = `${objectPath}.json`;
    await mkdir(this.rootDirectory, { recursive: true });
    await writeFile(objectPath, bytes, { flag: "wx" });

    try {
      await writeFile(
        metadataPath,
        JSON.stringify({ contentType }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      await unlink(objectPath).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string) {
    const objectPath = this.resolveKey(key);

    try {
      const [bytes, metadataBytes] = await Promise.all([
        readFile(objectPath),
        readFile(`${objectPath}.json`),
      ]);
      const metadata = JSON.parse(metadataBytes.toString("utf8")) as {
        contentType?: unknown;
      };

      if (typeof metadata.contentType !== "string" || metadata.contentType.trim() === "") {
        throw new Error("Object metadata does not contain a valid content type.");
      }

      return { bytes, contentType: metadata.contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    const objectPath = this.resolveKey(key);
    await Promise.all([
      unlink(objectPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }),
      unlink(`${objectPath}.json`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }),
    ]);
  }

  async createSignedUploadUrl(key: string): Promise<{ signedUrl: string; token: string }> {
    const objectPath = this.resolveKey(key);
    const expiresAt = Date.now() + uploadTokenLifetimeMs;
    const token = createLocalObjectToken("upload", path.basename(objectPath), expiresAt);
    const url = new URL(
      `/storage/v1/object/upload/sign/${encodeURIComponent(bucketName())}/${encodeURIComponent(key)}`,
      localStorageOrigin(),
    );
    url.searchParams.set("token", token);
    return { signedUrl: url.toString(), token };
  }

  async createSignedDownloadUrl(
    key: string,
    options: { expiresIn?: number; download?: string | boolean } = {},
  ): Promise<string> {
    this.resolveKey(key);
    const expiresIn = options.expiresIn ?? 300;
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 3600) {
      throw new RangeError("Local signed download URLs must expire within one hour.");
    }
    const expiresAt = Date.now() + expiresIn * 1000;
    const token = createLocalObjectToken("download", key, expiresAt);
    const url = new URL(`/api/local-storage/${encodeURIComponent(key)}`, localStorageOrigin());
    url.searchParams.set("token", token);
    if (options.download) url.searchParams.set("download", typeof options.download === "string" ? options.download : "1");
    return url.toString();
  }
}
