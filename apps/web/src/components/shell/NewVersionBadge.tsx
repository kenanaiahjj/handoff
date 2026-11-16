/** Small pill marking a handoff whose newest version this person has not opened yet. */
export function NewVersionBadge({ label = "New version" }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
      {label}
    </span>
  );
}
