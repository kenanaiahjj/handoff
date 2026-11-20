"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { CommentAttachment } from "./CommentPin";

const CommentEndpointContext = createContext<string | null>(null);

/** The comments endpoint of the version on screen, so comment boxes can upload and show images. */
export function CommentMediaProvider({ endpoint, children }: { endpoint: string; children: ReactNode }) {
  return <CommentEndpointContext.Provider value={endpoint}>{children}</CommentEndpointContext.Provider>;
}

export function useCommentEndpoint() {
  return useContext(CommentEndpointContext);
}

export function attachmentUrl(endpoint: string, id: string) {
  return `${endpoint}/attachments/${encodeURIComponent(id)}`;
}

const maxSide = 2400;
const maxBytes = 3 * 1024 * 1024;
export const acceptedImageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Shrinks big screenshots before upload: longest side 2400 px, kept as PNG when that stays small
 * (sharp UI text), otherwise WebP. GIFs are sent as they are so animation survives.
 */
async function prepareImage(file: File): Promise<{ blob: Blob; width: number | null; height: number | null }> {
  if (file.type === "image/gif") {
    if (file.size > maxBytes) throw new Error("GIFs can be up to 3 MB.");
    return { blob: file, width: null, height: null };
  }
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * ratio);
    const height = Math.round(bitmap.height * ratio);
    if (ratio === 1 && file.size <= maxBytes && acceptedImageTypes.includes(file.type)) return { blob: file, width, height };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    const encode = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = await encode("image/png");
    if (!blob || blob.size > maxBytes) blob = await encode("image/webp", 0.9);
    if (!blob || blob.size > maxBytes) blob = await encode("image/webp", 0.75);
    if (!blob || blob.size > maxBytes) throw new Error("This image is too large to attach.");
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

export async function uploadCommentImage(endpoint: string, file: File): Promise<CommentAttachment> {
  if (!acceptedImageTypes.includes(file.type)) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  const { blob, width, height } = await prepareImage(file);
  const response = await fetch(`${endpoint}/attachments`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || file.type,
      ...(width ? { "X-Image-Width": String(width) } : {}),
      ...(height ? { "X-Image-Height": String(height) } : {}),
    },
    body: blob,
  });
  const payload = (await response.json().catch(() => ({}))) as CommentAttachment & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The image could not be uploaded.");
  return payload;
}

/** A full-screen view of one image, closed with Escape, the close button or a click outside. */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      aria-label={alt}
      className="fixed inset-0 m-0 grid h-dvh max-h-none w-screen max-w-none place-items-center bg-transparent p-4 backdrop:bg-black/85 sm:p-10"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={onClose}
      ref={ref}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- private, access-checked image */}
      <img alt={alt} className="max-h-full max-w-full rounded-[8px] object-contain shadow-2xl" src={src} />
      <span className="absolute right-3 top-3 flex gap-1.5">
        <a className="grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80" download href={src} title="Download image">
          <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="M8 2.5v8m0 0L5 7.5m3 3 3-3M3 13h10" /></svg>
          <span className="sr-only">Download image</span>
        </a>
        <button aria-label="Close image" className="grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80" onClick={onClose} type="button">
          <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
        </button>
      </span>
    </dialog>
  );
}

/** Thumbnails under a comment; tapping one opens it full size. */
export function CommentAttachments({ attachments, className = "" }: { attachments?: CommentAttachment[]; className?: string }) {
  const endpoint = useCommentEndpoint();
  const [open, setOpen] = useState<string | null>(null);
  if (!endpoint || !attachments?.length) return null;
  const single = attachments.length === 1;
  return (
    <>
      <div className={"grid gap-1.5 " + (single ? "grid-cols-1" : "grid-cols-2") + (className ? " " + className : "")}>
        {attachments.map((attachment, index) => (
          <button
            aria-label={`Open image ${index + 1} of ${attachments.length}`}
            className="group relative block overflow-hidden rounded-[8px] border border-white/[0.08] bg-surface-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            key={attachment.id}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(attachment.id);
            }}
            style={single && attachment.width && attachment.height ? { aspectRatio: `${attachment.width} / ${attachment.height}`, maxHeight: 220 } : { aspectRatio: "4 / 3" }}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private, access-checked image */}
            <img alt="" className="size-full object-cover object-top transition-opacity group-hover:opacity-90" loading="lazy" src={attachmentUrl(endpoint, attachment.id)} />
          </button>
        ))}
      </div>
      {open ? <ImageLightbox alt="Comment image" onClose={() => setOpen(null)} src={attachmentUrl(endpoint, open)} /> : null}
    </>
  );
}

/** "3m", "2h", "Yesterday", "Mar 4": short times for comment headers; the full date goes in a tooltip. */
export function timeAgo(iso: string, now = Date.now()) {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "Just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 172_800) return "Yesterday";
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(iso).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

export function CommentTime({ iso }: { iso: string }) {
  // The label depends on "now"; render it after mount so server and client agree.
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setLabel(timeAgo(iso));
    const first = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [iso]);
  return <time className="shrink-0 text-[11px] text-foreground-subtle" dateTime={iso} title={new Date(iso).toLocaleString()}>{label ?? ""}</time>;
}
