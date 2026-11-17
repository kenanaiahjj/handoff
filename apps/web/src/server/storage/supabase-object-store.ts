import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ObjectStore } from "./object-store";
import { LocalObjectStore } from "./local-object-store";

const objectKeyPattern = /^[a-f0-9]{48}$/;
const defaultBucket = "handoff-assets";

function requiredEnvironment(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set before using Supabase Storage.`);
  return value;
}

function storageClient() {
  const url = requiredEnvironment("SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "asbir-handoff-server" } },
    storage: { useNewHostname: true },
  });
}

export function getSupabaseStorageUrl() {
  if (process.env.NODE_ENV === "development" && process.env.ASBIR_LOCAL_DEV_MODE === "1") {
    return new URL(process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000").origin;
  }

  const configured = process.env.SUPABASE_STORAGE_URL?.trim();
  if (configured) return new URL(configured).origin;

  const url = new URL(requiredEnvironment("SUPABASE_URL"));
  if (url.hostname.endsWith(".supabase.co")) {
    url.hostname = `${url.hostname.slice(0, -".supabase.co".length)}.storage.supabase.co`;
  }
  return url.origin;
}

function requireObjectKey(key: string) {
  if (!objectKeyPattern.test(key)) {
    throw new TypeError("Object keys must be 48 lowercase hexadecimal characters.");
  }
}

function bucketName() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || defaultBucket;
}

function throwStorageError(error: unknown, action: string): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Supabase Storage ${action} failed: ${message}`, { cause: error });
}

export class SupabaseObjectStore implements ObjectStore {
  constructor(
    private readonly getClient: () => SupabaseClient = storageClient,
    private readonly getBucketName: () => string = bucketName,
  ) {}

  async put(key: string, bytes: Uint8Array, contentType: string) {
    requireObjectKey(key);
    const { error } = await this.getClient().storage.from(this.getBucketName()).upload(
      key,
      Buffer.from(bytes),
      { contentType, cacheControl: "31536000", upsert: false },
    );
    if (error) throwStorageError(error, "upload");
  }

  async get(key: string) {
    requireObjectKey(key);
    const { data, error } = await this.getClient().storage.from(this.getBucketName()).download(key);
    if (error) {
      const statusCode = "statusCode" in error ? String(error.statusCode) : "";
      if (statusCode === "404" || /not found/i.test(error.message)) return null;
      throwStorageError(error, "download");
    }
    if (!data) return null;
    return {
      bytes: new Uint8Array(await data.arrayBuffer()),
      contentType: data.type || "application/octet-stream",
    };
  }

  async delete(key: string) {
    requireObjectKey(key);
    const { error } = await this.getClient().storage.from(this.getBucketName()).remove([key]);
    if (error) throwStorageError(error, "delete");
  }

  async createSignedUploadUrl(key: string) {
    requireObjectKey(key);
    const { data, error } = await this.getClient().storage.from(this.getBucketName())
      .createSignedUploadUrl(key, { upsert: false });
    if (error) throwStorageError(error, "sign upload");
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async createSignedDownloadUrl(
    key: string,
    options: { expiresIn?: number; download?: boolean | string } = {},
  ) {
    requireObjectKey(key);
    const { data, error } = await this.getClient().storage.from(this.getBucketName())
      .createSignedUrl(key, options.expiresIn ?? 300, { download: options.download });
    if (error) throwStorageError(error, "sign download");
    return data.signedUrl;
  }
}

const globalForObjectStore = globalThis as typeof globalThis & { __asbirObjectStore?: ObjectStore };
const productionObjectStore = new SupabaseObjectStore();
const localDevelopmentObjectStore = new LocalObjectStore();

/** Allow tests to inject an in-memory or local adapter without exposing it in production. */
export function setObjectStoreForTests(store: ObjectStore | undefined) {
  if (process.env.NODE_ENV === "production") throw new Error("Storage injection is unavailable in production.");
  globalForObjectStore.__asbirObjectStore = store;
}

export const objectStore: ObjectStore = new Proxy(productionObjectStore, {
  get(target, property) {
    const override = process.env.NODE_ENV === "test" ? globalForObjectStore.__asbirObjectStore : undefined;
    const localDevelopment = process.env.NODE_ENV === "development" && process.env.ASBIR_LOCAL_DEV_MODE === "1";
    const selected = override ?? (localDevelopment ? localDevelopmentObjectStore : target);
    const value = Reflect.get(selected, property, selected);
    return typeof value === "function" ? value.bind(selected) : value;
  },
});
