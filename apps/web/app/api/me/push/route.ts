import { z } from "zod";
import { getSessionForRequest } from "@/src/server/workspace-access";
import { countPushSubscriptions, deletePushSubscription, isPushEnabled, pushPublicKey, savePushSubscription } from "@/src/server/services/push";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Whether push is set up on this server, its public key, and how many devices this person has on. */
export async function GET(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json({
    enabled: isPushEnabled(),
    publicKey: isPushEnabled() ? pushPublicKey() : null,
    devices: isPushEnabled() ? await countPushSubscriptions(session.user.id) : 0,
  });
}

/** Saves this device's push subscription. */
export async function POST(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isPushEnabled()) return Response.json({ error: "Push notifications aren't set up on this server." }, { status: 503 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That subscription isn't valid." }, { status: 400 });
  await savePushSubscription(session.user.id, parsed.data, request.headers.get("user-agent"));
  return Response.json({ subscribed: true });
}

/** Turns push off for one device: ?endpoint=… */
export async function DELETE(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (endpoint) await deletePushSubscription(session.user.id, endpoint);
  return Response.json({ subscribed: false });
}
