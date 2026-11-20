import { getDatabase } from "@/src/server/db";
import { assignSlugs, findBySlug } from "@/src/lib/route-slugs";

type Named = { id: string; name: string };

/** Every project in the workspace, so slugs match no matter which projects a viewer can see. */
async function workspaceProjects(workspaceId: string) {
  return (await getDatabase().prepare("SELECT id, name FROM project WHERE workspace_id = ?").all(workspaceId)) as Named[];
}

async function projectHandoffs(workspaceId: string, projectId: string) {
  return (await getDatabase().prepare("SELECT id, name FROM handoff WHERE workspace_id = ? AND project_id = ?").all(workspaceId, projectId)) as Named[];
}

/** Project id → slug for the whole workspace. */
export async function projectSlugs(workspaceId: string) {
  return assignSlugs(await workspaceProjects(workspaceId));
}

/** Handoff id → slug within one project. */
export async function handoffSlugs(workspaceId: string, projectId: string) {
  return assignSlugs(await projectHandoffs(workspaceId, projectId));
}

/** Readable path for a handoff, for links built where only ids are at hand. */
export async function handoffPath(workspaceId: string, projectId: string, handoffId: string) {
  const [projects, handoffs] = await Promise.all([projectSlugs(workspaceId), handoffSlugs(workspaceId, projectId)]);
  return `/projects/${projects.get(projectId) ?? projectId}/handoffs/${handoffs.get(handoffId) ?? handoffId}`;
}

/**
 * Turns the address segments into ids. `canonical` is the readable path; callers redirect to it when
 * the address used an id or an outdated form.
 */
export async function resolveProjectRoute(workspaceId: string, projectSegment: string, handoffSegment?: string) {
  const projects = await workspaceProjects(workspaceId);
  const project = findBySlug(projects, projectSegment);
  if (!project) return null;
  const projectSlug = assignSlugs(projects).get(project.id) as string;
  if (handoffSegment === undefined) return { projectId: project.id, canonical: `/projects/${projectSlug}` };
  const handoffs = await projectHandoffs(workspaceId, project.id);
  const handoff = findBySlug(handoffs, handoffSegment);
  if (!handoff) return null;
  const handoffSlug = assignSlugs(handoffs).get(handoff.id) as string;
  return { projectId: project.id, handoffId: handoff.id, canonical: `/projects/${projectSlug}/handoffs/${handoffSlug}` };
}

/** Slugs for every project and handoff in the workspace, for pages that link across projects. */
export async function workspaceRouteSlugs(workspaceId: string) {
  const [projects, handoffs] = await Promise.all([
    workspaceProjects(workspaceId),
    getDatabase().prepare("SELECT id, name, project_id AS projectId FROM handoff WHERE workspace_id = ?").all(workspaceId) as Promise<Array<Named & { projectId: string }>>,
  ]);
  const projectSlug = assignSlugs(projects);
  const byProject = new Map<string, Named[]>();
  for (const handoff of handoffs) byProject.set(handoff.projectId, [...(byProject.get(handoff.projectId) ?? []), handoff]);
  const handoffSlug = new Map<string, string>();
  for (const siblings of byProject.values()) for (const [id, slug] of assignSlugs(siblings)) handoffSlug.set(id, slug);
  return {
    project: (projectId: string) => `/projects/${projectSlug.get(projectId) ?? projectId}`,
    handoff: (projectId: string, handoffId: string) => `/projects/${projectSlug.get(projectId) ?? projectId}/handoffs/${handoffSlug.get(handoffId) ?? handoffId}`,
    projectSlugs: projectSlug,
  };
}
