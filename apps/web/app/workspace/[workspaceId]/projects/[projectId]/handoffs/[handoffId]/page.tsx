import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";
import type { SnapshotEnvelope } from "@asbir/snapshot-contract";
import { formatFigmaCaptureScope } from "@asbir/snapshot-contract";
import { getHandoff, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { getProject } from "@/src/server/repositories/projects";
import { getVersion } from "@/src/server/repositories/versions";
import { HandoffReviewSurface, type ReviewVersionSummary } from "@/src/components/canvas/HandoffReviewSurface";
import { PublishCanvasLink } from "@/src/components/canvas/PublishCanvasLink";
import { DeleteHandoffButton, DeleteHandoffVersionButton } from "@/src/components/canvas/HandoffLifecycleActions";
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
  const canManageHandoffs = membership.role === "owner" || membership.role === "designer";
  const project = getProject({ workspaceId, projectId });
  if (!project) notFound();
  const versions = listHandoffVersions({ workspaceId, handoffId }) as ReviewVersionSummary[];
  if (!versions.length) {
    const projectHref = `/workspace/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`;
    return (
      <main className="grid h-dvh min-h-0 place-items-center overflow-y-auto bg-surface px-5 py-8 text-foreground">
        <section aria-labelledby="empty-handoff-title" className="w-full max-w-lg rounded-panel border border-border bg-surface p-5">
          <h1 className="text-lg font-semibold text-foreground" id="empty-handoff-title">{handoff.name}</h1>
          <p className="mt-2 text-sm leading-6 text-foreground-muted">No versions remain in this handoff. Capture a new Figma snapshot to continue.</p>
          <div className="mt-5"><HandoffSetupForm mode="handoff" input={{ workspaceId, projectId, handoffs: [{ id: handoffId, name: handoff.name }], initialHandoffId: handoffId }} /></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Link className="min-h-9 rounded-control px-3 py-2 text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground" href={projectHref}>Back to project</Link>
            {canManageHandoffs ? <DeleteHandoffButton
              endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}`}
              handoffName={handoff.name}
              returnHref={projectHref}
            /> : null}
          </div>
        </section>
      </main>
    );
  }

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
  const captureScope = !visualOnly
    ? formatFigmaCaptureScope((version.snapshot as SnapshotEnvelope).sourceMetadata.captureScope)
    : null;
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
        <section aria-label="Release note and publish" className="rounded-control bg-surface p-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-subtle">Release note</p>
          <p className="mt-2 text-[12px] leading-5 text-foreground">{version.releaseNote || "No release note was provided for this snapshot."}</p>
          <p className="mt-2 font-mono text-[9px] text-foreground-subtle">{visualOnly ? "Visual-only snapshot" : `${nodeCount} captured elements`} · {version.source}</p>
          {captureScope ? <p className="mt-1 text-[10px] leading-4 text-foreground-muted">Capture scope · {captureScope}</p> : null}
          <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-foreground-subtle">
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
                sharingMode={handoff.sharingMode}
                canManage={canManageHandoffs}
              />
            </div>
          ) : null}
          {canManageHandoffs ? <div className="mt-3 flex justify-end border-t border-border pt-3">
            <DeleteHandoffButton
              endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}`}
              handoffName={handoff.name}
              returnHref={`/workspace/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`}
            />
          </div> : null}
        </section>
        <details className="rounded-control bg-surface p-3">
          <summary className="cursor-pointer text-[11px] font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Version history and capture details</summary>
          <ol className="mt-3 space-y-1">
            {versions.map((entry) => (
              <li className="flex items-center gap-1" key={entry.id}>
                <Link
                  aria-current={entry.id === selectedVersion.id ? "page" : undefined}
                  className={"flex min-w-0 flex-1 items-center justify-between gap-2 rounded-control px-2 py-2 text-[11px] " + (entry.id === selectedVersion.id ? "bg-surface-raised text-foreground" : "text-foreground-muted hover:bg-surface-raised hover:text-foreground")}
                  href={routePath + "?versionId=" + encodeURIComponent(entry.id)}
                >
                  <span>Version {entry.versionLabel}</span>
                  <span className="text-right text-[9px] text-foreground-subtle">{new Date(entry.createdAt).toLocaleDateString()}</span>
                </Link>
                {canManageHandoffs ? <DeleteHandoffVersionButton
                  endpoint={`/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/versions/${encodeURIComponent(entry.id)}`}
                  handoffName={handoff.name}
                  versionLabel={entry.versionLabel}
                  handoffHref={routePath}
                /> : null}
              </li>
            ))}
          </ol>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-2 border-t border-border pt-3 text-[10px]">
            <dt className="text-foreground-subtle">Captured</dt><dd className="text-right text-foreground-muted">{new Date(version.capturedAt).toLocaleString()}</dd>
            <dt className="text-foreground-subtle">Revision</dt><dd className="truncate text-right font-mono text-foreground-muted">{version.sourceRevisionId ?? "Not provided"}</dd>
            <dt className="text-foreground-subtle">Content hash</dt><dd className="truncate text-right font-mono text-foreground-muted" title={version.contentHash}>{version.contentHash.slice(0, 12)}…</dd>
          </dl>
        </details>
        <HandoffSetupForm mode="handoff" input={{ workspaceId, projectId, handoffs: [{ id: handoffId, name: handoff.name }], initialHandoffId: handoffId }} />
      </div>
    ) : null,
  };

  return (
    <div className="h-dvh min-h-0 overflow-hidden bg-surface text-foreground">
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
