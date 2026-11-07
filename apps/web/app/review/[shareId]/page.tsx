import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import { getPublishedHandoffByShareId, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { getProject } from "@/src/server/repositories/projects";
import { getVersion } from "@/src/server/repositories/versions";
import { HandoffReviewSurface, type ReviewVersionSummary } from "@/src/components/canvas/HandoffReviewSurface";

export const instant = false;

type PublishedReviewPageProps = {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<{ versionId?: string | string[] }>;
};

export default async function PublishedReviewPage({ params, searchParams }: PublishedReviewPageProps) {
  const { shareId } = await params;
  const query = await searchParams;
  const requestedVersionId = Array.isArray(query.versionId) ? query.versionId[0] : query.versionId;
  const reviewPath = `/review/${encodeURIComponent(shareId)}`;
  const redirectPath = requestedVersionId
    ? `${reviewPath}?versionId=${encodeURIComponent(requestedVersionId)}`
    : reviewPath;

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
  const publishedThroughIndex = allVersions.findIndex((version) => version.id === handoff.publishedVersionId);
  if (publishedThroughIndex < 0) notFound();

  const versions = allVersions.slice(publishedThroughIndex);
  const selectedVersion = versions.find((version) => version.id === requestedVersionId) ?? versions[0];
  if (!selectedVersion) notFound();

  const version = getVersion({ workspaceId: handoff.workspaceId, versionId: selectedVersion.id });
  if (!version || version.handoffId !== handoff.id) notFound();

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
        versionHrefPrefix={reviewPath}
        reviewHref={reviewPath}
        reviewShareId={shareId}
        publishedVersionId={handoff.publishedVersionId}
        canManageIntegrations={true}
        canAnnotate={true}
        canUseLocalPreview={true}
      />
    </main>
  );
}
