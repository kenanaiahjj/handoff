import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDirectory } from "../db";
import type { ObjectStore } from "./object-store";

const objectKeyPattern = /^[a-f0-9]{48}$/;

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
}

export const objectStore = new LocalObjectStore();
