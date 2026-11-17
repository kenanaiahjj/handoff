"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const uploadHint = "Upload a structured ZIP package for exact layout data, or a PNG, JPEG, WebP, or SVG render for visual-only review.";
type HandoffTarget = { id: string; name: string };
type PackageUploadIntent = {
  storageUrl: string;
  bucket: string;
  uploadProtocol?: "tus" | "direct";
  path: string;
  token: string;
  contentType: string;
};

const resumableThresholdBytes = 6 * 1024 * 1024;
const resumableChunkBytes = 6 * 1024 * 1024;

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uploadRequest(input: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Blob | null;
  onProgress?: (loaded: number) => void;
}) {
  return new Promise<XMLHttpRequest>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(input.method, input.url);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(input.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
      else reject(new Error(`Supabase Storage rejected the upload (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Supabase Storage upload failed because the network connection was interrupted."));
    xhr.onabort = () => reject(new Error("The snapshot upload was canceled."));
    xhr.send(input.body ?? null);
  });
}

function signedUploadUrl(intent: PackageUploadIntent) {
  const storageUrl = new URL(intent.storageUrl);
  const path = intent.path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(
    `/storage/v1/object/upload/sign/${encodeURIComponent(intent.bucket)}/${path}`,
    storageUrl.origin,
  );
  url.searchParams.set("token", intent.token);
  return url.toString();
}

function encodeUploadMetadata(value: string) {
  return btoa(value);
}

async function uploadPackageFile(file: File, intent: PackageUploadIntent, onProgress: (ratio: number) => void) {
  const storageUrl = new URL(intent.storageUrl);
  if (!/^https?:$/.test(storageUrl.protocol) || !intent.bucket || !intent.path || !intent.token) {
    throw new Error("Supabase returned an invalid upload credential.");
  }

  if (intent.uploadProtocol === "direct" || file.size <= resumableThresholdBytes) {
    await uploadRequest({
      method: "PUT",
      url: signedUploadUrl(intent),
      headers: { "Content-Type": intent.contentType },
      body: file,
      onProgress: (loaded) => onProgress(Math.min(1, loaded / file.size)),
    });
    onProgress(1);
    return;
  }

  const endpoint = new URL("/storage/v1/upload/resumable", storageUrl.origin).toString();
  const metadata = [
    ["bucketName", intent.bucket],
    ["objectName", intent.path],
    ["contentType", intent.contentType],
    ["cacheControl", "3600"],
  ].map(([key, value]) => `${key} ${encodeUploadMetadata(value)}`).join(",");
  const created = await uploadRequest({
    method: "POST",
    url: endpoint,
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(file.size),
      "Upload-Metadata": metadata,
      "x-signature": intent.token,
    },
  });
  const location = created.getResponseHeader("Location");
  if (!location) throw new Error("Supabase did not return a resumable upload URL.");
  const uploadUrl = new URL(location, endpoint);
  if (uploadUrl.origin !== storageUrl.origin) throw new Error("Supabase returned an upload URL on an unexpected host.");

  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + resumableChunkBytes, file.size));
    const sentOffset = offset;
    const response = await uploadRequest({
      method: "PATCH",
      url: uploadUrl.toString(),
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
        "x-signature": intent.token,
      },
      body: chunk,
      onProgress: (loaded) => onProgress(Math.min(1, (sentOffset + loaded) / file.size)),
    });
    const nextOffset = Number(response.getResponseHeader("Upload-Offset"));
    if (nextOffset !== offset + chunk.size) throw new Error("Supabase did not confirm the full upload chunk.");
    offset = nextOffset;
  }
  onProgress(1);
}

export function HandoffSetupForm({ input, mode }: {
  input: { workspaceId: string; projectId: string; handoffs: HandoffTarget[]; initialHandoffId?: string };
  mode: "project" | "handoff";
}) {
  const router = useRouter();
  const [handoffId, setHandoffId] = useState(input.initialHandoffId ?? "");
  const [handoffName, setHandoffName] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [source, setSource] = useState<"figma" | "upload">("figma");
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [pendingFinalizeUploadId, setPendingFinalizeUploadId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const isNewHandoff = !handoffId;

  async function writeTokenToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  async function copyToken() {
    if (!token) return;
    setErrorMessage("");
    if (await writeTokenToClipboard(token)) setNotice("Capture token copied. Paste it into the Figma plugin now.");
    else setErrorMessage("Clipboard access was blocked. Select the token and copy it manually.");
  }

  async function finalizePackageImport(uploadId: string) {
    setPendingFinalizeUploadId(uploadId);
    let response: Response;
    try {
      response = await fetch(`/api/uploads/packages/${encodeURIComponent(uploadId)}/finalize`, { method: "POST" });
    } catch {
      throw new Error("The upload reached Storage, but we couldn't confirm finalization. Retry finalization.");
    }

    let result: { error?: string; handoffId?: string; versionId?: string };
    try {
      result = await response.json();
    } catch {
      if (!response.ok) result = {};
      else throw new Error("We couldn't confirm the finalization response. Retry finalization.");
    }
    if (!response.ok) {
      if (response.status < 500) setPendingFinalizeUploadId(null);
      throw new Error(result.error ?? "We couldn't finalize this snapshot.");
    }

    if (!result.handoffId || !result.versionId) {
      throw new Error("We couldn't confirm the finalization response. Retry finalization.");
    }
    setPendingFinalizeUploadId(null);
    router.push(`/workspace/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/handoffs/${encodeURIComponent(result.handoffId)}?versionId=${encodeURIComponent(result.versionId)}`);
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setErrorMessage("");
    setNotice("");
    setUploadProgress(null);

    try {
      if (pendingFinalizeUploadId) {
        await finalizePackageImport(pendingFinalizeUploadId);
        return;
      }

      if (source === "figma") {
        const response = await fetch("/api/capture-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            handoffId: handoffId || null,
            handoffName: handoffId ? null : handoffName,
            versionLabel,
            releaseNote: releaseNote || null,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "We couldn't create a capture token.");
        setToken(result.token);
        setExpiresAt(result.expiresAt);
        const copied = await writeTokenToClipboard(result.token);
        setNotice(copied
          ? "Capture token copied. Paste it into the Figma plugin. It expires in one hour and works once."
          : "Token created, but automatic copying was blocked. Use Copy token or select it and copy it manually. It expires in one hour and works once.");
        return;
      }

      const fileInput = form.elements.namedItem("file");
      const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : undefined;
      if (!file) throw new Error("Choose a snapshot file to upload.");
      if (file.size === 0) throw new Error("The snapshot file is empty.");
      if (file.size > 100_000_000) throw new Error("The snapshot file is larger than 100 MB.");

      const response = await fetch("/api/uploads/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          handoffId: handoffId || null,
          handoffName: handoffId ? null : handoffName,
          versionLabel,
          releaseNote: releaseNote || null,
          fileName: file.name,
          sizeBytes: file.size,
          sha256: await sha256Hex(file),
        }),
      });
      const upload = await response.json();
      if (!response.ok) throw new Error(upload.error ?? "We couldn't prepare the snapshot upload.");

      await uploadPackageFile(file, upload as PackageUploadIntent, setUploadProgress);
      await finalizePackageImport(upload.uploadId);
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "We couldn't complete this handoff.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="handoff-setup-title"
      className={mode === "project"
        ? "workspace-pane p-5"
        : "rounded-panel bg-surface p-3"}
    >
      <h2 className={mode === "project" ? "text-[15px] font-semibold tracking-[-0.01em] text-foreground" : "text-[12px] font-semibold text-foreground"} id="handoff-setup-title">
        {mode === "project" ? "Start a handoff" : "Add a version"}
      </h2>
      <p className={mode === "project" ? "mt-2 text-[13px] leading-5 text-foreground-muted" : "mb-3 mt-1 text-[10px] leading-4 text-foreground-subtle"}>
        {mode === "project" ? "Create a new handoff or add a version. Capture from Figma or upload a snapshot." : "Capture an update from Figma or upload a snapshot."}
      </p>

      {token ? (
        <div className="mt-4 border-t border-border/80 pt-4">
          <label className="block text-xs font-medium text-foreground-muted" htmlFor="figma-capture-token">One-time capture token</label>
          <div className="mt-2 flex gap-2">
            <input id="figma-capture-token" readOnly value={token} className="min-h-11 min-w-0 flex-1 rounded-control border border-transparent bg-surface-inset px-3 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            <button type="button" onClick={() => void copyToken()} className="capture-primary-action min-h-11 rounded-control px-4 text-xs font-semibold">Copy token</button>
          </div>
          {expiresAt ? <p className="mt-2 text-xs text-foreground-subtle">Expires {new Date(expiresAt).toLocaleTimeString()} · use once</p> : null}
          <p className="mt-2 text-xs leading-5 text-foreground-muted">In Figma, load <code className="font-mono text-foreground">integrations/figma-plugin/manifest.json</code> as a development plugin, enter the app URL and token, then select the frames to capture.</p>
          <button type="button" onClick={() => { setToken(null); setExpiresAt(null); setVersionLabel(""); setReleaseNote(""); setNotice(""); setErrorMessage(""); }} className="mt-4 min-h-10 rounded-control bg-surface-raised px-4 text-xs font-medium text-foreground transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Hide token</button>
        </div>
      ) : (
        <form className="mt-4 grid gap-x-3 gap-y-4 border-t border-border/80 pt-4 sm:grid-cols-2" onSubmit={submit}>
          {mode === "project" && input.handoffs.length ? (
            <label className="block text-xs font-medium text-foreground-muted sm:col-span-2" htmlFor="handoff-destination">
              Handoff
              <select id="handoff-destination" value={handoffId} onChange={(event) => { setPendingFinalizeUploadId(null); setHandoffId(event.target.value); }} className="mt-2 min-h-11 w-full rounded-control border border-transparent bg-surface-inset px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <option value="">New handoff</option>
                {input.handoffs.map((handoff) => <option key={handoff.id} value={handoff.id}>{handoff.name}</option>)}
              </select>
            </label>
          ) : mode === "handoff" ? (
            <div className="sm:col-span-2">
              <span className="block text-xs font-medium text-foreground-muted">Handoff</span>
              <p className="mt-2 rounded-control border border-transparent bg-surface-inset px-3 py-3 text-sm text-foreground">{input.handoffs.find((handoff) => handoff.id === handoffId)?.name ?? "Current handoff"}</p>
            </div>
          ) : null}

          {isNewHandoff ? (
            <label className="block text-xs font-medium text-foreground-muted sm:col-span-2" htmlFor="setup-handoff-name">
              Handoff name
              <input id="setup-handoff-name" name="handoffName" value={handoffName} onChange={(event) => { setPendingFinalizeUploadId(null); setHandoffName(event.target.value); }} required maxLength={100} placeholder="Checkout redesign" className="mt-2 min-h-11 w-full rounded-control border border-transparent bg-surface-inset px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            </label>
          ) : null}

          <label className="block text-xs font-medium text-foreground-muted" htmlFor="setup-version-label">
            Version label
            <input id="setup-version-label" name="versionLabel" value={versionLabel} onChange={(event) => { setPendingFinalizeUploadId(null); setVersionLabel(event.target.value); }} required maxLength={80} placeholder="1.0.0" className="mt-2 min-h-11 w-full rounded-control border border-transparent bg-surface-inset px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>
          <label className="block text-xs font-medium text-foreground-muted" htmlFor="setup-release-note">
            Release note <span className="font-normal text-foreground-subtle">(optional)</span>
            <input id="setup-release-note" name="releaseNote" value={releaseNote} onChange={(event) => { setPendingFinalizeUploadId(null); setReleaseNote(event.target.value); }} maxLength={4000} placeholder="What should reviewers focus on?" className="mt-2 min-h-11 w-full rounded-control border border-transparent bg-surface-inset px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </label>

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-xs font-medium text-foreground-muted">Version source</legend>
            <div aria-label="Version source" className="dial-segmented grid w-full grid-cols-2" role="group">
              {(["figma", "upload"] as const).map((option) => (
                <button
                  aria-pressed={source === option}
                  className="min-h-9 px-2 text-[13px]"
                  key={option}
                  onClick={() => { setPendingFinalizeUploadId(null); setSource(option); setErrorMessage(""); setNotice(""); }}
                  type="button"
                >
                  {option === "figma" ? "Capture from Figma" : "Upload snapshot"}
                </button>
              ))}
            </div>
          </fieldset>

          {source === "upload" ? (
            <label className="block text-xs font-medium text-foreground-muted sm:col-span-2" htmlFor="setup-snapshot-file">
              Snapshot file
              <input
                accept=".zip,.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml,application/zip"
                aria-describedby="setup-upload-hint"
                className="mt-2 block min-h-11 w-full rounded-control border border-transparent bg-surface-inset px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-surface-raised file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
                id="setup-snapshot-file"
                name="file"
                onChange={() => setPendingFinalizeUploadId(null)}
                required
                type="file"
              />
              <span className="mt-2 block text-xs leading-5 text-foreground-muted" id="setup-upload-hint">{uploadHint}</span>
            </label>
          ) : (
            <p className="rounded-control bg-surface-raised px-3 py-3 text-xs leading-5 text-foreground-muted sm:col-span-2">Create a short-lived token, then use the Figma plugin to capture selected frames and their inspectable properties.</p>
          )}

          {errorMessage ? <p className="text-xs text-danger sm:col-span-2" role="alert">{errorMessage}</p> : null}
          {pending && uploadProgress !== null ? <p className="text-xs text-foreground-muted sm:col-span-2" role="status">Uploading directly to Storage: {Math.round(uploadProgress * 100)}%</p> : null}
          <div className="sm:col-span-2">
            <button className="capture-primary-action min-h-12 w-full rounded-control px-4 text-sm font-semibold disabled:opacity-60" disabled={pending} type="submit">
              {pending ? source === "figma" ? "Creating token…" : "Uploading…" : pendingFinalizeUploadId ? "Retry finalization" : source === "figma" ? "Create Figma capture token" : handoffId ? "Add version" : "Create handoff"}
            </button>
          </div>
        </form>
      )}
      {errorMessage && token ? <p className="mt-3 text-xs text-warning" role="alert">{errorMessage}</p> : null}
      {notice ? <p className="mt-3 text-xs leading-5 text-success" role="status">{notice}</p> : null}
    </section>
  );
}
