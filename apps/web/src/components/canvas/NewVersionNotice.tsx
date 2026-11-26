"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const checkEveryMs = 15_000;

type LatestVersion = { id: string; versionLabel: string; createdAt: string };

/**
 * Tells someone reviewing a handoff that a newer version was published (a capture landed from
 * Figma, or a teammate removed screens), and opens it in place without a manual reload.
 */
export function NewVersionNotice({
  endpoint,
  knownLatestVersionId,
  versionHref,
}: {
  endpoint: string;
  /** The newest version when this page was rendered. */
  knownLatestVersionId: string;
  /** Link to a version of this handoff, given its id. */
  versionHref: string;
}) {
  const router = useRouter();
  const [latest, setLatest] = useState<LatestVersion | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    async function check() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { latest: LatestVersion | null };
        if (!cancelled && body.latest && body.latest.id !== knownLatestVersionId) setLatest(body.latest);
      } catch {
        // Offline or the server is restarting; the next check tries again.
      } finally {
        checking = false;
      }
    }
    const interval = window.setInterval(check, checkEveryMs);
    const onVisible = () => void check();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [endpoint, knownLatestVersionId]);

  // Hidden once that version is the page's newest (it was opened, or the page reloaded).
  if (!latest || latest.id === dismissedId || latest.id === knownLatestVersionId) return null;

  const open = () => {
    setDismissedId(latest.id);
    const separator = versionHref.includes("?") ? "&" : "?";
    router.push(`${versionHref}${separator}versionId=${encodeURIComponent(latest.id)}`);
    router.refresh();
  };

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[max(12px,env(safe-area-inset-top))]">
      <section
        aria-labelledby="new-version-notice-title"
        className="pointer-events-auto flex w-full max-w-[460px] items-center gap-3 toast-surface rounded-[14px] py-2.5 pl-4 pr-2.5"
        role="status"
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--toast-brand)] shadow-[0_0_0_3px_rgb(227_161_58/0.18)]" />
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-foreground" id="new-version-notice-title">
          New version published: <span className="font-semibold">{latest.versionLabel}</span>
        </p>
        <button
          className="h-8 shrink-0 rounded-[9px] bg-[#ececec] px-3 text-[12px] font-semibold text-[#141414] transition-[background-color,transform] hover:bg-white active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
          onClick={open}
          type="button"
        >
          Open it
        </button>
        <button
          aria-label="Dismiss"
          className="grid size-8 shrink-0 place-items-center rounded-[8px] text-foreground-subtle transition-colors hover:bg-white/[0.06] hover:text-foreground"
          onClick={() => setDismissedId(latest.id)}
          type="button"
        >
          <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </section>
    </div>
  );
}
