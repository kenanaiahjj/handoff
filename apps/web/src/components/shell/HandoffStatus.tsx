"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { handoffStatusMeta, type HandoffReviewStatus } from "@/src/lib/handoff-status";

const order: HandoffReviewStatus[] = ["draft", "in_review", "approved"];

/** A handoff's review status. Owners and designers can change it from the chip. */
export function HandoffStatusChip({ status: initial, endpoint, className = "" }: { status: HandoffReviewStatus; endpoint?: string; className?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [, startRefresh] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const meta = handoffStatusMeta[status];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(next: HandoffReviewStatus) {
    setOpen(false);
    if (!endpoint || next === status) return;
    const previous = status;
    setStatus(next);
    setError("");
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) }).catch(() => null);
    if (!response?.ok) {
      setStatus(previous);
      setError("Couldn't update the status.");
      return;
    }
    startRefresh(() => router.refresh());
  }

  const chip = (
    <>
      <span aria-hidden="true" className={"size-1.5 rounded-full " + meta.dot} />
      {meta.label}
    </>
  );

  if (!endpoint) {
    return <span className={className + " inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium " + meta.chip} title={meta.hint}>{chip}</span>;
  }

  return (
    <div className={"relative shrink-0 " + className} ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Status: ${meta.label}. Change status`}
        className={"inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-[filter] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " + meta.chip}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {chip}
        <svg aria-hidden="true" className="size-2.5 opacity-60" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open ? (
        <div className="dial-popover absolute right-0 top-8 z-30 w-52 p-1" role="menu">
          {order.map((key) => (
            <button
              aria-checked={key === status}
              className="flex w-full items-start gap-2.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-white/[0.07]"
              key={key}
              onClick={() => void choose(key)}
              role="menuitemradio"
              type="button"
            >
              <span aria-hidden="true" className={"mt-[5px] size-1.5 shrink-0 rounded-full " + handoffStatusMeta[key].dot} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-foreground">{handoffStatusMeta[key].label}</span>
                <span className="block text-[11px] text-foreground-subtle">{handoffStatusMeta[key].hint}</span>
              </span>
              {key === status ? <svg aria-hidden="true" className="mt-0.5 size-3.5 text-foreground" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7" /></svg> : null}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="absolute right-0 top-8 z-20 w-44 rounded-control bg-surface-raised px-2.5 py-1.5 text-[11px] text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
