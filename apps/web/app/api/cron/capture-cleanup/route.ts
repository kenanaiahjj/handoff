import { cleanupCaptureUploads } from "@/src/server/services/capture-cleanup";

export const maxDuration = 300;

/**
 * Daily cleanup of Figma capture uploads that will never be saved, run by Vercel Cron (see
 * vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET"; without it the route refuses.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  return Response.json(await cleanupCaptureUploads());
}
