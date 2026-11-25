"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DistortionWave } from "distortion-waves";
import { devVersionReadyEvent, useWaveSettings, waveStyle } from "@/src/components/motion/wave";
import { showToast } from "@/src/components/shell/Toaster";
import {
  finalizeVersionLabel,
  nextVersionLabel,
  releaseNotePreview,
  startsFromLatest,
  versionLabelBase,
  versionLabelMaxLength,
  versionLabelStart,
} from "@/src/lib/version-label";
import { ReleaseNoteDialog } from "./release-note-dialog";

type ReadyVersion = { handoffId: string; versionId: string; label: string; via: "figma" | "upload"; newHandoff: boolean };

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
  input: {
    workspaceId: string;
    projectId: string;
    handoffs: HandoffTarget[];
    initialHandoffId?: string;
    /** Label of the initial handoff's newest version; other handoffs' labels are fetched when picked. */
    latestVersionLabel?: string | null;
  };
  mode: "project" | "handoff";
}) {
  const router = useRouter();
  // The wave pictures both views, so each needs the pane's own opaque background.
  const paneBackground = mode === "project" ? "bg-[var(--workspace-pane)]" : "bg-surface";
  const [handoffId, setHandoffId] = useState(input.initialHandoffId ?? "");
  const [handoffName, setHandoffName] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [releaseNoteOpen, setReleaseNoteOpen] = useState(false);
  const [fetchedLatest, setFetchedLatest] = useState<{ handoffId: string; label: string | null } | null>(null);
  const versionLabelRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<"figma" | "upload">("figma");
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [pendingFinalizeUploadId, setPendingFinalizeUploadId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  /** Set once the new version exists (upload finalized, or the Figma plugin finished): the wave reveals it. */
  const [ready, setReady] = useState<ReadyVersion | null>(null);
  const [tokenLabel, setTokenLabel] = useState("");
  const wave = useWaveSettings();
  const submitRef = useRef<HTMLButtonElement>(null);
  const copyTokenRef = useRef<HTMLButtonElement>(null);
  const openCanvasRef = useRef<HTMLAnchorElement>(null);
  const isNewHandoff = !handoffId;
  const latestVersionLabel = !handoffId
    ? null
    : fetchedLatest?.handoffId === handoffId
      ? fetchedLatest.label
      : handoffId === input.initialHandoffId ? input.latestVersionLabel ?? null : null;
  const latestBase = versionLabelBase(latestVersionLabel);
  const showLatestSuggestion = Boolean(latestBase) && !startsFromLatest(versionLabel, latestVersionLabel);
  const nextLabel = nextVersionLabel(latestVersionLabel);
  const showNextSuggestion = Boolean(nextLabel) && !startsFromLatest(versionLabel, nextLabel);

  // While a capture token is showing, watch for the Figma plugin to finish so the form can say so.
  useEffect(() => {
    if (!token || ready) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/capture-sessions/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: input.workspaceId, token }),
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const result = await response.json() as { status: string; handoffId?: string; versionId?: string };
        if (result.status === "ready" && result.handoffId && result.versionId && !cancelled) {
          setReady({ handoffId: result.handoffId, versionId: result.versionId, label: tokenLabel, via: "figma", newHandoff: !handoffId });
          router.refresh();
        }
      } catch {
        // Offline for a moment; the next check tries again.
      }
    };
    const interval = window.setInterval(() => void check(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [handoffId, input.workspaceId, ready, router, token, tokenLabel]);

  // Local testing: the Waves bar shows the ready view with pretend data (nothing is created).
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const play = () => setReady((current) => current ? null : {
      handoffId: input.handoffs[0]?.id ?? "demo",
      versionId: "demo",
      label: finalizeVersionLabel(versionLabel) || "2.0",
      via: "upload",
      newHandoff: !input.handoffs.length,
    });
    window.addEventListener(devVersionReadyEvent, play);
    return () => window.removeEventListener(devVersionReadyEvent, play);
  }, [input.handoffs, versionLabel]);

  function addAnother() {
    setReady(null);
    setToken(null);
    setExpiresAt(null);
    setVersionLabel("");
    setReleaseNote("");
    setNotice("");
    setErrorMessage("");
  }

  // Picking another handoff in the project form: look up its newest label for the suggestion.
  useEffect(() => {
    if (!handoffId || (handoffId === input.initialHandoffId && input.latestVersionLabel !== undefined)) return;
    const controller = new AbortController();
    const url = `/api/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/handoffs/${encodeURIComponent(handoffId)}/versions/latest`;
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { latest?: { versionLabel?: string } | null } | null) => {
        setFetchedLatest({ handoffId, label: result?.latest?.versionLabel ?? null });
      })
      .catch(() => {
        // No suggestion when the lookup fails; the field still works.
      });
    return () => controller.abort();
  }, [handoffId, input.initialHandoffId, input.latestVersionLabel, input.projectId, input.workspaceId]);

  /** Put a suggested label in the field and leave the cursor at its end, ready for a description. */
  function applyVersionLabel(start: string) {
    setPendingFinalizeUploadId(null);
    setVersionLabel(start);
    requestAnimationFrame(() => {
      const field = versionLabelRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(start.length, start.length);
    });
  }

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
    setReady({ handoffId: result.handoffId, versionId: result.versionId, label: finalizeVersionLabel(versionLabel), via: "upload", newHandoff: !handoffId });
    // The page's version lists catch up underneath; the canvas opens from the ready view.
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setErrorMessage("");
    setNotice("");
    setUploadProgress(null);
    const finalVersionLabel = finalizeVersionLabel(versionLabel);

    try {
      if (!finalVersionLabel) throw new Error("Add a version label.");
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
            versionLabel: finalVersionLabel,
            releaseNote: releaseNote || null,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "We couldn't create a capture token.");
        setToken(result.token);
        setTokenLabel(finalVersionLabel);
        setExpiresAt(result.expiresAt);
        const copied = await writeTokenToClipboard(result.token);
        showToast(copied ? "Capture token copied" : "Capture token created");
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
          versionLabel: finalVersionLabel,
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

      {/* Capturing needs Figma's desktop plugin and uploads need its exported file, so phones get a pointer instead. */}
      <p className={"phone-only rounded-control bg-surface-inset text-foreground-muted " + (mode === "project" ? "mt-5 px-3.5 py-3 text-[13px] leading-5" : "px-3 py-2.5 text-[11px] leading-4")}>
        Adding a version needs Figma on a computer. Open this page there to capture screens or upload a snapshot.
      </p>
      <div className="phone-hidden">
      <DistortionWave
        className="wave-capture"
        live={false}
        onFinish={(revealed) => { if (revealed) openCanvasRef.current?.focus({ preventScroll: true }); }}
        palette={wave.palette}
          waveStyle={waveStyle}
        reducedMotion={wave.reducedMotion}
        revealed={Boolean(ready)}
        revealedContent={ready ? (
          <div className={"flex h-full flex-col pb-6 pt-2 " + paneBackground}>
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-[#ff8a3d]/15 text-[#ff8a3d]">
              <svg className="size-4" fill="none" viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>
            </span>
            <p className="mt-4 text-[18px] font-semibold tracking-[-0.01em] text-foreground" role="status">
              {ready.label ? `v${ready.label.split(" · ")[0].replace(/^v/i, "")} is ready` : "Your version is ready"}
            </p>
            <p className="mt-1.5 text-[13px] leading-5 text-foreground-muted">
              {ready.newHandoff ? "Your new handoff" : input.handoffs.find((handoff) => handoff.id === ready.handoffId)?.name ?? "The handoff"}
              {ready.via === "figma" ? " has the screens you captured in Figma." : " has the snapshot you uploaded."} Publish it from the canvas when you want reviewers to see it.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                className="capture-primary-action inline-flex min-h-11 items-center rounded-control px-5 text-sm font-semibold"
                href={`/projects/${encodeURIComponent(input.projectId)}/handoffs/${encodeURIComponent(ready.handoffId)}?versionId=${encodeURIComponent(ready.versionId)}`}
                ref={openCanvasRef}
              >
                Open canvas
              </Link>
              <button className="dial-button min-h-11 px-4 text-sm" onClick={addAnother} type="button">Add another version</button>
            </div>
          </div>
        ) : null}
        source={ready?.via === "figma" ? copyTokenRef : submitRef}
      >
      <div className={"h-full " + paneBackground}>
      {token ? (
        <div className="mt-5">
          <label className="block text-xs font-medium text-foreground-muted" htmlFor="figma-capture-token">One-time capture token</label>
          <div className="mt-2 flex gap-2">
            <input id="figma-capture-token" readOnly value={token} className="min-h-11 min-w-0 flex-1 rounded-control border border-transparent bg-surface-inset px-3 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            <button type="button" onClick={() => void copyToken()} ref={copyTokenRef} className="capture-primary-action min-h-11 rounded-control px-4 text-xs font-semibold">Copy token</button>
          </div>
          {expiresAt ? <p className="mt-2 text-xs text-foreground-subtle">Expires {new Date(expiresAt).toLocaleTimeString()} · use once</p> : null}
          <p className="mt-2 text-xs leading-5 text-foreground-muted">In Figma, load <code className="font-mono text-foreground">integrations/figma-plugin/manifest.json</code> as a development plugin, enter the app URL and token, then select the frames to capture.</p>
          <button type="button" onClick={() => { setToken(null); setExpiresAt(null); setVersionLabel(""); setReleaseNote(""); setNotice(""); setErrorMessage(""); }} className="mt-4 min-h-10 rounded-control bg-surface-raised px-4 text-xs font-medium text-foreground transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Hide token</button>
        </div>
      ) : (
        <form className="mt-5 grid gap-x-3 gap-y-4 sm:grid-cols-2" onSubmit={submit}>
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

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-foreground-muted" htmlFor="setup-version-label">Version label</label>
            <input
              aria-describedby={latestBase ? "setup-version-latest" : undefined}
              className="mt-2 min-h-11 w-full rounded-control border border-transparent bg-surface-inset px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              id="setup-version-label"
              maxLength={versionLabelMaxLength}
              name="versionLabel"
              onChange={(event) => { setPendingFinalizeUploadId(null); setVersionLabel(event.target.value); }}
              placeholder={latestBase ? `${latestBase} · What changed` : "1.0.0"}
              ref={versionLabelRef}
              required
              value={versionLabel}
            />
            {latestBase ? (
              <div className="mt-2 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 truncate text-[11px] text-foreground-subtle" id="setup-version-latest">
                  Latest: <span className="text-foreground-muted">{latestVersionLabel}</span>
                </span>
                <span className="ml-auto flex shrink-0 gap-1.5">
                  {showLatestSuggestion ? (
                    <button
                      className="dial-button min-h-7 rounded-full px-2.5 text-[11px]"
                      onClick={() => applyVersionLabel(versionLabelStart(latestVersionLabel))}
                      type="button"
                    >
                      Start from {latestBase}
                    </button>
                  ) : null}
                  {showNextSuggestion && nextLabel ? (
                    <button
                      className="dial-button min-h-7 rounded-full px-2.5 text-[11px]"
                      onClick={() => applyVersionLabel(nextLabel)}
                      type="button"
                    >
                      Next: {nextLabel}
                    </button>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            {releaseNote ? (
              <div className="flex items-start gap-3 rounded-control bg-surface-inset px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-foreground-muted">Release note</span>
                  <p className="mt-0.5 truncate text-[13px] text-foreground" title={releaseNote}>{releaseNotePreview(releaseNote)}</p>
                </div>
                <button
                  aria-haspopup="dialog"
                  className="dial-button min-h-8 shrink-0 px-3 text-xs"
                  onClick={() => setReleaseNoteOpen(true)}
                  type="button"
                >
                  Edit<span className="sr-only"> release note</span>
                </button>
                <button
                  className="dial-button min-h-8 shrink-0 px-3 text-xs"
                  onClick={() => { setPendingFinalizeUploadId(null); setReleaseNote(""); }}
                  type="button"
                >
                  Remove<span className="sr-only"> release note</span>
                </button>
              </div>
            ) : (
              <button
                aria-haspopup="dialog"
                className="dial-button min-h-10 w-full justify-start px-3 text-xs"
                onClick={() => setReleaseNoteOpen(true)}
                type="button"
              >
                <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg>
                Add release note
                <span className="font-normal text-foreground-subtle">(optional)</span>
              </button>
            )}
          </div>

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
            <button className="capture-primary-action min-h-12 w-full rounded-control px-4 text-sm font-semibold disabled:opacity-60" disabled={pending} ref={submitRef} type="submit">
              {pending ? source === "figma" ? "Creating token…" : "Uploading…" : pendingFinalizeUploadId ? "Retry finalization" : source === "figma" ? "Create Figma capture token" : handoffId ? "Add version" : "Create handoff"}
            </button>
          </div>
        </form>
      )}
      {releaseNoteOpen ? (
        <ReleaseNoteDialog
          initialValue={releaseNote}
          onClose={() => setReleaseNoteOpen(false)}
          onSave={(note) => {
            setPendingFinalizeUploadId(null);
            setReleaseNote(note);
            setReleaseNoteOpen(false);
          }}
        />
      ) : null}
      {errorMessage && token ? <p className="mt-3 text-xs text-warning" role="alert">{errorMessage}</p> : null}
      {notice ? <p className="mt-3 text-xs leading-5 text-success" role="status">{notice}</p> : null}
      {token && !ready ? <p className="mt-3 flex items-center gap-2 text-xs text-foreground-subtle"><span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-[#ff8a3d]" />Waiting for the capture from Figma…</p> : null}
      </div>
      </DistortionWave>
      </div>
    </section>
  );
}
