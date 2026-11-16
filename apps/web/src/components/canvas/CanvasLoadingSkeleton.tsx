/**
 * Shown while a handoff canvas streams in. Mirrors the real layout (toolbar, screen list,
 * canvas, details panel) so the page doesn't jump when it loads.
 */
export function CanvasLoadingSkeleton() {
  const bar = "animate-pulse rounded-control bg-surface-raised";
  return (
    <div aria-busy="true" className="flex h-dvh min-h-0 flex-col overflow-hidden bg-surface text-foreground" role="status">
      <span className="sr-only">Loading canvas…</span>
      <div aria-hidden="true" className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        <span className="size-6 animate-pulse rounded-md bg-surface-raised" />
        <span className={`${bar} h-4 w-24`} />
        <span className={`${bar} ml-2 hidden h-8 w-64 sm:block`} />
        <span className="ml-auto flex items-center gap-1.5">
          {[56, 88, 72, 64, 96].map((width, index) => (
            <span className={`${bar} hidden h-7 lg:block`} key={index} style={{ width }} />
          ))}
          <span className="h-8 w-20 animate-pulse rounded-full bg-surface-strong" />
        </span>
      </div>
      <div aria-hidden="true" className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        <div className="hidden min-h-0 flex-col gap-2 border-r border-border p-3 lg:flex">
          <span className={`${bar} h-9 w-full`} />
          <span className={`${bar} h-9 w-full`} />
          <span className={`${bar} mt-3 h-3 w-20`} />
          {Array.from({ length: 9 }, (_, index) => (
            <span className={`${bar} h-7`} key={index} style={{ width: `${70 + ((index * 17) % 30)}%` }} />
          ))}
        </div>
        <div className="review-dot-grid relative grid min-h-0 place-items-center">
          <div className="flex flex-col items-center gap-3">
            <span className="size-6 animate-spin rounded-full border-2 border-border-strong border-t-foreground-muted motion-reduce:animate-none" />
            <span className="text-[12px] text-foreground-muted">Loading canvas…</span>
          </div>
        </div>
        <div className="hidden min-h-0 flex-col gap-3 border-l border-border p-3 lg:flex">
          <span className={`${bar} h-9 w-full`} />
          <span className={`${bar} mt-2 h-4 w-24`} />
          {[90, 75, 85, 60, 80].map((width, index) => (
            <span className={`${bar} h-3`} key={index} style={{ width: `${width}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
