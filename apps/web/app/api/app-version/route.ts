type ReleaseNote = { sha: string; date: string; subject: string };

/** Commit subjects read like "feat(plugin): add x"; show them as plain sentences. */
function plainSubject(subject: string) {
  const text = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The build this server is running. Open windows compare it with their own to offer a reload;
 * `since` (the commit a window loaded) adds how many changes it is missing and what they are.
 */
export function GET(request: Request) {
  const since = new URL(request.url).searchParams.get("since");
  let notes: ReleaseNote[] = [];
  try {
    notes = JSON.parse(process.env.ASBIR_RELEASE_NOTES || "[]") as ReleaseNote[];
  } catch {
    notes = [];
  }
  const index = since ? notes.findIndex((note) => note.sha === since) : -1;
  const missing = index > 0 ? notes.slice(0, index) : [];
  return Response.json(
    {
      buildId: process.env.NEXT_PUBLIC_ASBIR_BUILD_ID ?? null,
      version: process.env.ASBIR_VERSION_LABEL ?? null,
      changes: index >= 0 ? index : null,
      notes: missing.slice(0, 12).map((note) => plainSubject(note.subject)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
