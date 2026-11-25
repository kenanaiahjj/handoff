import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { listVisiblePublishedReviewVersions, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";
import { ensurePlaygroundCopy, PlaygroundBuildingError } from "@/src/server/services/playground";
import { getProject } from "@/src/server/repositories/projects";
import { getCanvasVersion } from "@/src/server/services/version-canvas";
import { HandoffReviewSurface, type ReviewVersionSummary } from "@/src/components/canvas/HandoffReviewSurface";
import { parseCompareRouteState, type CompareRouteState } from "@/src/components/canvas/compare-state";

// The first visit after a deploy may build the Playground (two versions and their images).
export const maxDuration = 120;

export const instant = false;

type PlaygroundPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** The Playground: a sample project anyone signed in can explore. Each person gets their own copy to comment on. */
export default async function PlaygroundPage({ searchParams }: PlaygroundPageProps) {
  const query = await searchParams;
  const requestHeaders = await headers();
  const session = await getSessionForHeaders(requestHeaders);
  if (!session) redirect(`/sign-in?redirectTo=${encodeURIComponent("/playground")}`);

  let shareId: string;
  try {
    shareId = await ensurePlaygroundCopy(session.user.id);
  } catch (error) {
    if (!(error instanceof PlaygroundBuildingError)) throw error;
    return (
      <main className="grid h-dvh place-items-center bg-surface px-6 text-center text-foreground">
        <meta content="4" httpEquiv="refresh" />
        <div>
          <p className="text-[15px] font-semibold">Setting up the Playground…</p>
          <p className="mt-1 text-[13px] text-foreground-muted">This takes a few seconds the first time. The page reloads on its own.</p>
        </div>
      </main>
    );
  }

  const access = await resolvePublishedReviewAccess(shareId, requestHeaders);
  if (!access?.decision.allowed) notFound();
  const handoff = access.handoff;
  const [project, versions] = await Promise.all([
    getProject({ workspaceId: handoff.workspaceId, projectId: handoff.projectId }),
    listVisiblePublishedReviewVersions(handoff) as Promise<ReviewVersionSummary[]>,
  ]);
  if (!project || !versions.length) notFound();

  const comparison = new URLSearchParams();
  for (const key of ["compare", "compareFrom", "compareTo", "compareFrame", "compareMode"]) {
    const value = first(query[key]);
    if (value) comparison.set(key, value);
  }
  const parsed = parseCompareRouteState(comparison);
  const compareState: CompareRouteState | null = parsed &&
    versions.some((entry) => entry.id === parsed.fromVersionId) &&
    versions.some((entry) => entry.id === parsed.toVersionId)
    ? parsed
    : null;
  const requestedVersionId = first(query.versionId);
  const selected = versions.find((entry) => entry.id === requestedVersionId) ??
    versions.find((entry) => entry.id === compareState?.toVersionId) ??
    versions[0];
  const version = await getCanvasVersion({ workspaceId: handoff.workspaceId, versionId: selected.id });
  if (!version || version.handoffId !== handoff.id) notFound();

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-surface text-foreground">
      <HandoffReviewSurface
        workspaceId={handoff.workspaceId}
        projectId={handoff.projectId}
        handoffId={handoff.id}
        projectName="Playground"
        projectHref="/projects"
        handoffName={handoff.name}
        versions={versions}
        selectedVersion={version}
        initialCompareRouteState={compareState}
        versionHrefPrefix="/playground"
        reviewHref="/playground"
        reviewShareId={shareId}
        publicReviewShareId={shareId}
        publishedVersionId={handoff.publishedVersionId}
        canManageIntegrations={false}
        canManageSharing={false}
        canAnnotate={access.decision.canWrite}
        canComment={access.decision.canComment}
        commentIdentity={null}
        canUseLocalPreview={false}
        team={null}
      />
    </main>
  );
}
