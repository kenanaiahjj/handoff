import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { getPublishedHandoffByShareId, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { getProject } from "@/src/server/repositories/projects";
import { getVersion } from "@/src/server/repositories/versions";
import { HandoffReviewSurface, type ReviewVersionSummary } from "@/src/components/canvas/HandoffReviewSurface";
import { LayoutFindings } from "@/src/components/canvas/LayoutFindings";
import { PublishedChangelogPanel } from "@/src/components/canvas/PublishedChangelogPanel";
import { versionsVisibleToReview } from "@/src/server/services/published-review";
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
  }>;
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PublishedReviewPage({ params, searchParams }: PublishedReviewPageProps) {
  const { shareId } = await params;
  const query = await searchParams;
  const requestedVersionId = firstQueryValue(query.versionId);
  const reviewPath = `/review/${encodeURIComponent(shareId)}`;
  const redirectQuery = new URLSearchParams();
  for (const key of ["versionId", "compare", "compareFrom", "compareTo", "compareFrame", "compareMode"] as const) {
    const value = firstQueryValue(query[key]);
    if (value) redirectQuery.set(key, value);
  }
  const redirectPath = reviewPath + (redirectQuery.toString() ? `?${redirectQuery.toString()}` : "");

  const session = await getSessionForHeaders(await headers());
  if (!session) redirect(`/sign-in?redirectTo=${encodeURIComponent(redirectPath)}`);

  const handoff = getPublishedHandoffByShareId(shareId);
  if (!handoff) notFound();
  const membership = getDatabase()
    .prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
    .get(handoff.workspaceId, session.user.id) as { role: string } | undefined;
  if (!membership) notFound();

  const project = getProject({ workspaceId: handoff.workspaceId, projectId: handoff.projectId });
  if (!project) notFound();

  const allVersions = listHandoffVersions({ workspaceId: handoff.workspaceId, handoffId: handoff.id }) as ReviewVersionSummary[];
  const versions = versionsVisibleToReview(allVersions, handoff.publishedVersionId);
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

  const findingsEndpoint = `/api/workspaces/${encodeURIComponent(handoff.workspaceId)}/projects/${encodeURIComponent(handoff.projectId)}/handoffs/${encodeURIComponent(handoff.id)}/versions/${encodeURIComponent(selectedVersion.id)}/findings`;
  const dockPanels = {
    qa: <LayoutFindings endpoint={findingsEndpoint} />,
    changelog: <PublishedChangelogPanel
      endpoint={`/api/review/${encodeURIComponent(shareId)}/changelog`}
      versionId={selectedVersion.id}
      versionLabel={selectedVersion.versionLabel}
      versionHrefPrefix={reviewPath}
    />,
  };

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-[#202020] text-[#dedede]">
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
        publishedVersionId={handoff.publishedVersionId}
        canManageIntegrations={true}
        canAnnotate={true}
        canUseLocalPreview={true}
        dockPanels={dockPanels}
      />
    </main>
  );
}
