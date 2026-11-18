"use client";

import { useState } from "react";
import { initialsFor } from "@/src/lib/profile-fields";

/** A person's photo, or their initials when there is none (or it can't be loaded). */
export function Avatar({ name, src, size = 28, className = "" }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small photo from our own route or the sign-in provider.
      <img
        alt=""
        className={"shrink-0 rounded-full object-cover ring-1 ring-white/10 " + className}
        height={size}
        onError={() => setFailedSrc(src)}
        referrerPolicy="no-referrer"
        src={src}
        style={style}
        width={size}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={"grid shrink-0 place-items-center rounded-full bg-surface-strong font-semibold text-foreground " + className}
      style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {initialsFor(name)}
    </span>
  );
}
