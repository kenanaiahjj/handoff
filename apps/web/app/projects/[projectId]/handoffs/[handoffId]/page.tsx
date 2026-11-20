import { notFound, redirect } from "next/navigation";
import HandoffPage from "@/app/workspace/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/page";
import { getCompanyWorkspace } from "@/src/server/services/company-workspace";
import { resolveProjectRoute } from "@/src/server/services/route-slugs";

export const maxDuration = 300;
export const instant = false;

type SearchParams = Record<string, string | string[] | undefined>;

/** `/projects/<project-slug>/handoffs/<handoff-slug>`; old id links redirect to the readable address. */
export default async function HandoffRoute({ params, searchParams }: { params: Promise<{ projectId: string; handoffId: string }>; searchParams: Promise<SearchParams> }) {
  const workspace = await getCompanyWorkspace();
  if (!workspace) redirect("/workspace");
  const { projectId: projectSegment, handoffId: handoffSegment } = await params;
  const route = await resolveProjectRoute(workspace.id, projectSegment, handoffSegment);
  if (!route?.handoffId) notFound();
  if (`/projects/${projectSegment}/handoffs/${handoffSegment}` !== route.canonical) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    redirect(route.canonical + (query.size ? `?${query}` : ""));
  }
  return (
    <HandoffPage
      params={Promise.resolve({ workspaceId: workspace.id, projectId: route.projectId, handoffId: route.handoffId })}
      searchParams={searchParams as never}
    />
  );
}
