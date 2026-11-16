/** The build this server is running. Open windows compare it with their own to offer a reload. */
export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_ASBIR_BUILD_ID ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
