/**
 * Shown while a handoff canvas streams in. Mirrors the real layout (toolbar, screen list,
 * canvas, details panel) so the page doesn't jump when it loads.
 */
export function CanvasLoadingSkeleton() {
  const bar = "skeleton";
  return (
    <div aria-busy="true" className="flex h-dvh min-h-0 flex-col overflow-hidden bg-surface text-foreground" role="status">
      <span className="sr-only">Loading canvas…</span>
      <div aria-hidden="true" className="flex h-12 shrink-0 items-center gap-3 px-3">
        <span className="skeleton size-6 !rounded-md" />
        <span className={`${bar} h-4 w-24`} />
        <span className={`${bar} ml-2 hidden h-8 w-64 sm:block`} />
        <span className="ml-auto flex items-center gap-1.5">
          {[56, 88, 72, 64, 96].map((width, index) => (
            <span className={`${bar} hidden h-7 lg:block`} key={index} style={{ width }} />
          ))}
          <span className="skeleton h-8 w-20 !rounded-full" />
        </span>
      </div>
      <div aria-hidden="true" className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        <div className="hidden min-h-0 flex-col gap-2 p-3 lg:flex">
          <span className={`${bar} h-9 w-full`} />
          <span className={`${bar} h-9 w-full`} />
          <span className={`${bar} mt-3 h-3 w-20`} />
          {Array.from({ length: 9 }, (_, index) => (
            <span className={`${bar} h-7`} key={index} style={{ width: `${70 + ((index * 17) % 30)}%` }} />
          ))}
        </div>
        <div className="review-dot-grid relative grid min-h-0 place-items-center">
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" className="loading-breathe size-9 rounded-[10px] shadow-[0_12px_32px_rgb(0_0_0/0.5)]" height={36} src="/icons/asbir-handoff-v4-192.png" width={36} />
            <span className="loading-sheen-text text-[12px] font-medium">Loading canvas…</span>
          </div>
        </div>
        <div className="hidden min-h-0 flex-col gap-3 p-3 lg:flex">
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
