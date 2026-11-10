import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { hasPendingHandoffReviewInvite, listVisiblePublishedReviewVersions, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";
import { getProject } from "@/src/server/repositories/projects";
import { getVersion } from "@/src/server/repositories/versions";
import { HandoffReviewSurface, type ReviewVersionSummary } from "@/src/components/canvas/HandoffReviewSurface";
import { LayoutFindings } from "@/src/components/canvas/LayoutFindings";
import { PublishedChangelogPanel } from "@/src/components/canvas/PublishedChangelogPanel";
import { parseCompareRouteState, type CompareRouteState } from "@/src/components/canvas/compare-state";

export const instant = false;

type PublishedReviewPageProps = {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<{
    versionId?: string | string[];
    compare?: string | string[];
    compareFrom?: string | string[];
    compareTo?: string | string[];
    compareFrame?: string | string[];
    compareMode?: string | string[];
    invite?: string | string[];
  }>;
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PublishedReviewPage({ params, searchParams }: PublishedReviewPageProps) {
  const { shareId } = await params;
  const query = await searchParams;
  const requestedVersionId = firstQueryValue(query.versionId);
  const inviteToken = firstQueryValue(query.invite);
  const reviewPath = `/review/${encodeURIComponent(shareId)}`;
  const redirectQuery = new URLSearchParams();
  for (const key of ["versionId", "compare", "compareFrom", "compareTo", "compareFrame", "compareMode"] as const) {
    const value = firstQueryValue(query[key]);
    if (value) redirectQuery.set(key, value);
  }
  const redirectPath = reviewPath + (redirectQuery.toString() ? `?${redirectQuery.toString()}` : "");

  const requestHeaders = await headers();
  if (inviteToken) {
    redirect(`/api/review/${encodeURIComponent(shareId)}/access?invite=${encodeURIComponent(inviteToken)}&returnTo=${encodeURIComponent(redirectPath)}`);
  }
  const session = await getSessionForHeaders(requestHeaders);
  const hasPendingInvite = hasPendingHandoffReviewInvite(requestHeaders, shareId);
  const access = await resolvePublishedReviewAccess(shareId, requestHeaders);
  if (!access) notFound();
  if (!access.decision.allowed) {
    if (!session && access.handoff.sharingMode !== "anyone" && (access.handoff.sharingMode === "workspace" || hasPendingInvite)) {
      const signInQuery = new URLSearchParams(redirectQuery);
      if (inviteToken) signInQuery.set("invite", inviteToken);
      const signInPath = reviewPath + (signInQuery.toString() ? `?${signInQuery.toString()}` : "");
      redirect(`/sign-in?redirectTo=${encodeURIComponent(signInPath)}`);
    }
    notFound();
  }

  if (hasPendingInvite && access.decision.reason === "invited-recipient") {
    redirect(`/api/review/${encodeURIComponent(shareId)}/access?returnTo=${encodeURIComponent(redirectPath)}`);
  }

  const handoff = access.handoff;

  const project = getProject({ workspaceId: handoff.workspaceId, projectId: handoff.projectId });
  if (!project) notFound();

  const versions = listVisiblePublishedReviewVersions(handoff) as ReviewVersionSummary[];
  if (!versions.length) notFound();

  const comparisonSearch = new URLSearchParams();
  for (const key of ["compare", "compareFrom", "compareTo", "compareFrame", "compareMode"] as const) {
    const value = firstQueryValue(query[key]);
    if (value) comparisonSearch.set(key, value);
  }
  const parsedCompareRouteState = parseCompareRouteState(comparisonSearch);
  const initialCompareRouteState: CompareRouteState | null = parsedCompareRouteState &&
    versions.some((entry) => entry.id === parsedCompareRouteState.fromVersionId) &&
    versions.some((entry) => entry.id === parsedCompareRouteState.toVersionId)
    ? parsedCompareRouteState
    : null;
  const selectedVersion = versions.find((version) => version.id === requestedVersionId) ??
    versions.find((version) => version.id === initialCompareRouteState?.toVersionId) ??
    versions[0];
  if (!selectedVersion) notFound();

  const version = getVersion({ workspaceId: handoff.workspaceId, versionId: selectedVersion.id });
  if (!version || version.handoffId !== handoff.id) notFound();

  const findingsEndpoint = `/api/review/${encodeURIComponent(shareId)}/versions/${encodeURIComponent(selectedVersion.id)}/findings`;
  const dockPanels = {
    qa: <LayoutFindings endpoint={findingsEndpoint} canEdit={Boolean(access.membershipRole) && access.decision.canWrite} canComment={access.decision.canWrite} />,
    changelog: <PublishedChangelogPanel
      endpoint={`/api/review/${encodeURIComponent(shareId)}/changelog`}
      versionId={selectedVersion.id}
      versionLabel={selectedVersion.versionLabel}
      versionHrefPrefix={reviewPath}
    />,
  };

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-surface text-foreground">
      <HandoffReviewSurface
        workspaceId={handoff.workspaceId}
        projectId={handoff.projectId}
        handoffId={handoff.id}
        projectName={project.name}
        projectHref={reviewPath}
        handoffName={handoff.name}
        versions={versions}
        selectedVersion={version}
        initialCompareRouteState={initialCompareRouteState}
        versionHrefPrefix={reviewPath}
        reviewHref={reviewPath}
        reviewShareId={shareId}
        publicReviewShareId={shareId}
        publishedVersionId={handoff.publishedVersionId}
        canManageIntegrations={false}
        canAnnotate={access.decision.canWrite}
        canUseLocalPreview={false}
        canConfirmFrameMatches={false}
        dockPanels={dockPanels}
      />
    </main>
  );
}
