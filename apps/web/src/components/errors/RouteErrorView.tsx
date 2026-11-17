"use client";

import { useEffect } from "react";

/**
 * Shown when a page fails to load (for example a database or Storage hiccup) instead of a bare error
 * screen. Retrying re-fetches the page; the digest matches the server log entry for support.
 */
export function RouteErrorView({
  error,
  retry,
  title = "This page didn’t load",
  homeHref,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  homeHref?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-5 py-8 text-foreground">
      <section aria-labelledby="route-error-title" className="w-full max-w-md rounded-panel border border-border bg-surface p-5" role="alert">
        <h1 className="text-lg font-semibold" id="route-error-title">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">
          Something went wrong while loading it. Your handoffs and captures are safe. Try again; if it keeps happening, share the reference below.
        </p>
        {error.digest ? <p className="mt-3 font-mono text-[11px] text-foreground-subtle">Reference: {error.digest}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="dial-button min-h-9 px-3 py-2 text-xs" onClick={() => retry()} type="button">Try again</button>
          {homeHref ? <a className="dial-button min-h-9 px-3 py-2 text-xs" href={homeHref}>Go to home</a> : null}
        </div>
      </section>
    </main>
  );
}
