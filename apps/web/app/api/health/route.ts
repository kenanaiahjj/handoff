import { connection } from "next/server";
import { getDatabase } from "@/src/server/db";

/**
 * For the host's health checks: PostgreSQL answers. No sign-in needed, and this reveals nothing
 * about stored content.
 */
export async function GET() {
  // Always answered live, never prerendered at build time.
  await connection();
  try {
    (await getDatabase().prepare("SELECT 1").get());
    return Response.json(
      { ok: true, buildId: process.env.NEXT_PUBLIC_ASBIR_BUILD_ID ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[health]", error);
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
