import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import type { SnapshotEnvelope } from "@asbir/snapshot-contract";
import { getHandoff, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { getProject } from "@/src/server/repositories/projects";
import { getVersion } from "@/src/server/repositories/versions";
import { HandoffReviewSurface, type ReviewVersionSummary } from "@/src/components/canvas/HandoffReviewSurface";
import { PublishCanvasLink } from "@/src/components/canvas/PublishCanvasLink";
import { ChangelogPanel } from "@/src/components/canvas/ChangelogPanel";
import { LayoutFindings } from "@/src/components/canvas/LayoutFindings";
import { HandoffSetupForm } from "../../handoff-setup-form";
import { parseCompareRouteState, type CompareRouteState } from "@/src/components/canvas/compare-state";

export const instant = false;

type HandoffPageProps = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string }>;
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

export default async function HandoffPage({ params, searchParams }: HandoffPageProps) {
  await connection();
  const session = await getSessionForHeaders(await headers());
  if (!session) redirect("/sign-in");

  const [{ workspaceId, projectId, handoffId }, query] = await Promise.all([params, searchParams]);
  const membership = getDatabase()
    .prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, session.user.id) as { role: string } | undefined;
  const handoff = getHandoff({ workspaceId, projectId, handoffId });
  if (!membership || !handoff) notFound();
  const project = getProject({ workspaceId, projectId });
  if (!project) notFound();
  const versions = listHandoffVersions({ workspaceId, handoffId }) as ReviewVersionSummary[];
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
  const requestedVersionId = firstQueryValue(query.versionId) ?? initialCompareRouteState?.toVersionId;
  const selectedVersion = versions.find((version) => version.id === requestedVersionId) ?? versions[0];
  const version = getVersion({ workspaceId, versionId: selectedVersion.id });
  if (!version || version.handoffId !== handoffId) notFound();

  const visualOnly = version.visualOnly;
  const nodeCount = !visualOnly
    ? (version.snapshot as SnapshotEnvelope).frames.reduce((count, frame) => count + frame.nodes.length, 0)
    : 0;
  const canCreateVersion = true;
  const routePath = `/workspace/${workspaceId}/projects/${projectId}/handoffs/${handoffId}`;
  const changelogEndpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/changelog`;
  const findingsEndpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/versions/${encodeURIComponent(selectedVersion.id)}/findings`;
  const dockPanels = {
    qa: <LayoutFindings endpoint={findingsEndpoint} />,
    changelog: <ChangelogPanel endpoint={changelogEndpoint} versions={versions} selectedVersionId={selectedVersion.id} versionHrefPrefix={routePath} />,
    version: canCreateVersion ? (
      <div className="space-y-3">
        <section aria-label="Release note and publish" className="rounded-[6px] border border-[#383838] bg-[#242424] p-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#929292]">Release note</p>
          <p className="mt-2 text-[12px] leading-5 text-[#d0d0d0]">{version.releaseNote || "No release note was provided for this snapshot."}</p>
          <p className="mt-2 font-mono text-[9px] text-[#888]">{visualOnly ? "Visual-only snapshot" : `${nodeCount} captured elements`} · {version.source}</p>
          <p className="mt-3 border-t border-[#393939] pt-3 text-[10px] leading-4 text-[#929292]">
            {visualOnly
              ? "Uploaded pixels are frozen in this version. Exact padding, margins, and token bindings need a structured Figma capture."
              : "This render and its measurements are pinned to this version. Later source edits do not change it."}
          </p>
          {canCreateVersion ? (
            <div className="mt-3">
              <PublishCanvasLink
                key={selectedVersion.id}
                workspaceId={workspaceId}
                projectId={projectId}
                handoffId={handoffId}
                versionId={selectedVersion.id}
                latestVersionId={versions[0]?.id ?? selectedVersion.id}
                publishedVersionId={handoff.publishedVersionId}
                reviewShareId={handoff.reviewShareId}
              />
            </div>
          ) : null}
        </section>
        <details className="rounded-[6px] border border-[#383838] bg-[#242424] p-3">
          <summary className="cursor-pointer text-[11px] font-medium text-[#d0d0d0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]">Version history and capture details</summary>
          <ol className="mt-3 space-y-1">
            {versions.map((entry) => (
              <li key={entry.id}>
                <Link
                  aria-current={entry.id === selectedVersion.id ? "page" : undefined}
                  className={"flex items-center justify-between gap-2 rounded-[4px] px-2 py-2 text-[11px] " + (entry.id === selectedVersion.id ? "bg-[#363636] text-white" : "text-[#b9b9b9] hover:bg-[#303030] hover:text-white")}
                  href={routePath + "?versionId=" + encodeURIComponent(entry.id)}
                >
                  <span>Version {entry.versionLabel}</span>
                  <span className="text-right text-[9px] text-[#929292]">{new Date(entry.createdAt).toLocaleDateString()}</span>
                </Link>
              </li>
            ))}
          </ol>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-2 border-t border-[#3b3b3b] pt-3 text-[10px]">
            <dt className="text-[#929292]">Captured</dt><dd className="text-right text-[#c6c6c6]">{new Date(version.capturedAt).toLocaleString()}</dd>
            <dt className="text-[#929292]">Revision</dt><dd className="truncate text-right font-mono text-[#c6c6c6]">{version.sourceRevisionId ?? "Not provided"}</dd>
            <dt className="text-[#929292]">Content hash</dt><dd className="truncate text-right font-mono text-[#c6c6c6]" title={version.contentHash}>{version.contentHash.slice(0, 12)}…</dd>
          </dl>
        </details>
        <HandoffSetupForm mode="handoff" input={{ workspaceId, projectId, handoffs: [{ id: handoffId, name: handoff.name }], initialHandoffId: handoffId }} />
      </div>
    ) : null,
  };

  return (
    <div className="h-dvh min-h-0 overflow-hidden bg-[#202020] text-[#dedede]">
      <HandoffReviewSurface
        workspaceId={workspaceId}
        projectId={projectId}
        handoffId={handoffId}
        projectName={project.name}
        projectHref={`/workspace/${workspaceId}/projects/${projectId}`}
        handoffName={handoff.name}
        versions={versions}
        selectedVersion={version}
        initialCompareRouteState={initialCompareRouteState}
        versionHrefPrefix={routePath}
        reviewHref={handoff.reviewShareId ? `/review/${encodeURIComponent(handoff.reviewShareId)}` : null}
        reviewShareId={handoff.reviewShareId}
        publishedVersionId={handoff.publishedVersionId}
        canManageIntegrations={true}
        canAnnotate={true}
        canUseLocalPreview={true}
        dockPanels={dockPanels}
      />
    </div>
  );
}
