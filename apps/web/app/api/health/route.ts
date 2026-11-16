import { accessSync, constants } from "node:fs";
import { connection } from "next/server";
import { getDataDirectory, getDatabase } from "@/src/server/db";

/**
 * For the host's health checks: the database answers and the data folder is writable.
 * No sign-in needed, and it reveals nothing about the content.
 */
export async function GET() {
  // Always answered live, never prerendered at build time.
  await connection();
  try {
    getDatabase().prepare("SELECT 1").get();
    accessSync(getDataDirectory(), constants.W_OK);
    return Response.json(
      { ok: true, buildId: process.env.NEXT_PUBLIC_ASBIR_BUILD_ID ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[health]", error);
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
