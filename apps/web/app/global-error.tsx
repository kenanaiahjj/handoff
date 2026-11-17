"use client";

// Replaces the root layout when it fails, so it brings its own document and inline styles.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#161616", color: "#f2f2f2", fontFamily: "system-ui, sans-serif", padding: 20 }}>
        <main role="alert" style={{ maxWidth: 420 }}>
          <title>Asbir Handoff</title>
          <h1 style={{ fontSize: 18, margin: 0 }}>Asbir Handoff didn’t load</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#b5b5b5" }}>Something went wrong. Your handoffs and captures are safe. Try again in a moment.</p>
          {error.digest ? <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#8a8a8a" }}>Reference: {error.digest}</p> : null}
          <button onClick={() => retry()} style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, border: "1px solid #3a3a3a", background: "#242424", color: "#f2f2f2", cursor: "pointer" }} type="button">Try again</button>
        </main>
      </body>
    </html>
  );
}
