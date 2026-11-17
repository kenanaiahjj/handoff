export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  createSignedUploadUrl(key: string): Promise<{ signedUrl: string; token: string }>;
  createSignedDownloadUrl(key: string, options?: { expiresIn?: number; download?: boolean | string }): Promise<string>;
}
