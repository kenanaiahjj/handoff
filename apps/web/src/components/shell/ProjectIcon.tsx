"use client";

import { useRef, useState } from "react";

/** A project's logo, or its first letter on a tinted square when there is none. */
export function ProjectIcon({ name, src, size = 36, className = "" }: { name: string; src: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const radius = Math.round(size * 0.26);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small authenticated image served by our own route.
      <img
        alt=""
        className={"shrink-0 object-cover ring-1 ring-white/10 " + className}
        height={size}
        onError={() => setFailed(true)}
        src={src}
        style={{ width: size, height: size, borderRadius: radius }}
        width={size}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={"workspace-mark grid shrink-0 place-items-center font-semibold " + className}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.36) }}
    >
      {name.trim().slice(0, 1).toUpperCase() || "P"}
    </span>
  );
}

/** Crops the picked image to a centred square and scales it to 256 px, so uploads stay small. */
export async function squareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read this image.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (blob && blob.type === "image/webp") return blob;
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Could not read this image.");
  return png;
}

/** Owners and designers: click the icon to upload a logo, or remove it. */
export function ProjectIconEditor({ workspaceId, projectId, name, initialSrc, size = 48 }: {
  workspaceId: string;
  projectId: string;
  name: string;
  initialSrc: string | null;
  size?: number;
}) {
  const [src, setSrc] = useState(initialSrc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/icon`;

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const body = await squareImage(file);
      const response = await fetch(endpoint, { method: "PUT", headers: { "content-type": body.type }, body });
      const payload = (await response.json().catch(() => ({}))) as { iconVersion?: string; error?: string };
      if (!response.ok || !payload.iconVersion) throw new Error(payload.error ?? "Could not upload this image.");
      setSrc(`${endpoint}?v=${payload.iconVersion}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload this image.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setMenuOpen(false);
    setBusy(true);
    setError("");
    const response = await fetch(endpoint, { method: "DELETE" }).catch(() => null);
    if (response?.ok) setSrc(null);
    else setError("Could not remove the icon.");
    setBusy(false);
  }

  return (
    <div className="relative shrink-0">
      <input
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <button
        aria-busy={busy}
        aria-label={src ? `Change the icon for ${name}` : `Add an icon for ${name}`}
        className="project-icon-edit group relative block rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
        onClick={() => (src ? setMenuOpen((open) => !open) : inputRef.current?.click())}
        title={src ? "Change icon" : "Add a logo or icon"}
        type="button"
      >
        <ProjectIcon name={name} size={size} src={src} />
        <span
          aria-hidden="true"
          className={"absolute inset-0 grid place-items-center bg-black/55 text-white transition-opacity " + (busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}
          style={{ borderRadius: Math.round(size * 0.26) }}
        >
          {busy ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <svg className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="M2.5 11.5V13.5h2l7-7-2-2-7 7ZM10.5 3.5l2 2" /></svg>
          )}
        </span>
        {!src && !busy ? (
          <span aria-hidden="true" className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-[var(--surface)] bg-foreground text-[13px] font-semibold leading-none text-background">+</span>
        ) : null}
      </button>
      {menuOpen ? (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuOpen(false)} tabIndex={-1} type="button" />
          <div className="dial-popover absolute left-0 top-full z-50 mt-2 w-44 p-1.5" role="menu">
            <button className="flex w-full rounded-[7px] px-2 py-2 text-left text-[12px] text-foreground hover:bg-white/[0.06]" onClick={() => { setMenuOpen(false); inputRef.current?.click(); }} role="menuitem" type="button">Upload new image</button>
            <button className="flex w-full rounded-[7px] px-2 py-2 text-left text-[12px] text-danger hover:bg-danger/10" onClick={() => void remove()} role="menuitem" type="button">Remove icon</button>
          </div>
        </>
      ) : null}
      {error ? <p className="absolute left-0 top-full mt-2 w-56 text-[11px] text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
