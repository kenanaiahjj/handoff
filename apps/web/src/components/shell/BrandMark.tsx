import Image from "next/image";

/** Shared logo + wordmark so every surface spells the product the same way. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Image alt="" aria-hidden="true" className="size-6 shrink-0 rounded-md object-cover" height={24} src="/icons/asbir-handoff-v2-180.png" width={24} />
      <span className={"truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground" + (compact ? " max-sm:sr-only" : "")}>
        Asbir <span className="font-normal text-foreground-subtle">Handoff</span>
      </span>
    </span>
  );
}
