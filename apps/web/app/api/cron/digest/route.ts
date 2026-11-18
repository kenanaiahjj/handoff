import { sendWeeklyDigests } from "@/src/server/services/digest";

/**
 * Weekly Slack digest, run by Vercel Cron (see vercel.json). Vercel sends
 * "Authorization: Bearer $CRON_SECRET"; without CRON_SECRET set, the route refuses to run.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  return Response.json(await sendWeeklyDigests());
}
