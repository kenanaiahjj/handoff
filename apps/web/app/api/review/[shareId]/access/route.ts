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

  if (!access.session) {
    if (access.handoff.sharingMode === "invited" && token && getHandoffInviteByToken(shareId, token)) {
      const signInPath = `/sign-in?redirectTo=${encodeURIComponent(returnTo)}`;
      return redirectWithCookies(request, signInPath, [makeCookie(pendingCookie, token, 1800)]);
    }
    if (access.handoff.sharingMode === "workspace") {
      return Response.redirect(new URL(`/sign-in?redirectTo=${encodeURIComponent(returnTo)}`, request.url), 303);
    }
    return Response.json({ error: "An active invitation is required." }, { status: 403 });
  }

  if (!access.decision.allowed) {
    return Response.json({ error: "This invitation is invalid or does not match the signed-in email." }, { status: 403 });
  }

  if (access.decision.reason === "invited-recipient" && token) {
    const invite = getHandoffInviteByToken(shareId, token);
    const maxAge = invite?.expiresAt
      ? Math.max(1, Math.floor((Date.parse(invite.expiresAt) - Date.now()) / 1000))
      : 31536000;
    return redirectWithCookies(request, returnTo, [makeCookie(accessCookie, token, maxAge), clearPendingCookie]);
  }

  return redirectWithCookies(request, returnTo, [clearPendingCookie]);
}
