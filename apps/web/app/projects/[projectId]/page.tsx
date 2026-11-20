import { notFound, redirect } from "next/navigation";
import ProjectPage from "@/app/workspace/[workspaceId]/projects/[projectId]/page";
import { getCompanyWorkspace } from "@/src/server/services/company-workspace";
import { resolveProjectRoute } from "@/src/server/services/route-slugs";

export const instant = false;

/** `/projects/<project-slug>`; old `/projects/<id>` links redirect to the readable address. */
export default async function ProjectRoute({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await getCompanyWorkspace();
  if (!workspace) redirect("/workspace");
  const { projectId: segment } = await params;
  const route = await resolveProjectRoute(workspace.id, segment);
  if (!route) notFound();
  if (segment !== route.canonical.split("/")[2]) redirect(route.canonical + queryString(await searchParams));
  return <ProjectPage params={Promise.resolve({ workspaceId: workspace.id, projectId: route.projectId })} />;
}

function queryString(searchParams: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
