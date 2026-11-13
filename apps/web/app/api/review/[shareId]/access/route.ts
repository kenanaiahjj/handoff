import { getHandoffInviteByToken } from "@/src/server/repositories/handoffs";
import {
  getHandoffReviewInviteToken,
  handoffReviewAccessCookieName,
  handoffReviewPendingCookieName,
  resolvePublishedReviewAccess,
} from "@/src/server/services/handoff-review-access";

type ReviewAccessRoute = { params: Promise<{ shareId: string }> };

function reviewPath(shareId: string) {
  return `/review/${encodeURIComponent(shareId)}`;
}

function makeCookie(name: string, value: string, maxAge: number) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

function redirectWithCookies(request: Request, location: string, cookies: string[]) {
  const headers = new Headers({ "Cache-Control": "no-store", Location: new URL(location, request.url).toString() });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request, context: ReviewAccessRoute) {
  const { shareId } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("invite") || getHandoffReviewInviteToken(request.headers, shareId);
  const returnTo = url.searchParams.get("returnTo") ?? reviewPath(shareId);
  const safeReviewPath = reviewPath(shareId);
  if (returnTo !== safeReviewPath && !returnTo.startsWith(`${safeReviewPath}?`)) {
    return Response.json({ error: "The return path is invalid." }, { status: 400 });
  }

  const access = await resolvePublishedReviewAccess(shareId, request.headers, token);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  const pendingCookie = handoffReviewPendingCookieName(shareId);
  const accessCookie = handoffReviewAccessCookieName(shareId);
  const clearPendingCookie = makeCookie(pendingCookie, "", 0);

  if (access.decision.allowed && access.decision.reason === "public-link") {
    return redirectWithCookies(request, returnTo, [clearPendingCookie]);
  }

  if (access.decision.allowed && access.decision.reason === "invite-link" && token) {
    const invite = getHandoffInviteByToken(shareId, token);
    if (!invite) return Response.json({ error: "This invitation link is invalid, expired, or revoked." }, { status: 403 });
    const maxAge = invite.expiresAt
      ? Math.max(1, Math.floor((Date.parse(invite.expiresAt) - Date.now()) / 1000))
      : 31536000;
    return redirectWithCookies(request, returnTo, [makeCookie(accessCookie, token, maxAge), clearPendingCookie]);
  }

  if (!access.decision.allowed) {
    if (!access.session && access.handoff.sharingMode === "workspace") {
      return Response.redirect(new URL(`/sign-in?redirectTo=${encodeURIComponent(returnTo)}`, request.url), 303);
    }
    const message = access.decision.reason === "invite-required"
      ? "An active invitation link is required."
      : access.handoff.sharingMode === "invited"
        ? "This invitation link is invalid, expired, or revoked."
        : "This handoff is not available to this account.";
    return Response.json({ error: message }, { status: 403 });
  }

  return redirectWithCookies(request, returnTo, [clearPendingCookie]);
}
