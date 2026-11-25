import { projectIconUrl, projectIconVersions } from "@/src/server/services/project-icons";
import { getDatabase } from "@/src/server/db";
import { projectSlugs } from "@/src/server/services/route-slugs";
import { workspaceLogoUrl } from "@/src/server/services/workspace-settings";
import type { WorkspaceNavSection } from "./WorkspaceShell";

type WorkspaceNavigationProject = { id: string; name: string };
type WorkspacePage = "overview" | "projects" | "project" | "integrations" | "team" | "profile" | "activity" | "settings" | "handbook";

export async function createWorkspaceNavigation({
  workspaceId,
  companyName,
  projects,
  page,
  activeProjectId,
  canManage = false,
  isOwner = false,
}: {
  workspaceId: string;
  /** The team's name, e.g. "Asbir Tech", shown above the main links. */
  companyName?: string;
  projects: WorkspaceNavigationProject[];
  page: WorkspacePage;
  activeProjectId?: string;
  /** Owners and designers also get the Team page. */
  canManage?: boolean;
  /** Owners also get workspace Settings. */
  isOwner?: boolean;
}): Promise<WorkspaceNavSection[]> {
  const [iconVersions, logo, slugs] = await Promise.all([
    projects.length ? projectIconVersions(workspaceId) : Promise.resolve({} as Record<string, string>),
    (getDatabase().prepare("SELECT substr(sha256, 1, 12) AS version FROM workspace_logo WHERE workspace_id = ?").get(workspaceId) as Promise<{ version: string } | undefined>).catch(() => undefined),
    projects.length ? projectSlugs(workspaceId) : Promise.resolve(new Map<string, string>()),
  ]);
  return [
    {
      label: companyName ?? "Main",
      hideLabel: !companyName,
      imageUrl: workspaceLogoUrl(workspaceId, logo?.version),
      items: [
        { label: "Projects", href: `/workspace`, icon: "home", active: page === "overview" || page === "projects" },
        { label: "Activity", href: `/activity`, icon: "activity" as const, active: page === "activity" },
        ...(canManage ? [{ label: "Team", href: `/team`, icon: "users" as const, active: page === "team" }] : []),
        { label: "Integrations", href: `/integrations`, icon: "plug" as const, active: page === "integrations" },
        { label: "Naming handbook", href: `/handbook`, icon: "book" as const, active: page === "handbook" },
        ...(isOwner ? [{ label: "Settings", href: `/settings`, icon: "settings" as const, active: page === "settings" }] : []),
      ],
    },
    ...(projects.length
      ? [{
          label: "Projects",
          items: projects.map((project) => ({
            label: project.name,
            href: `/projects/${slugs.get(project.id) ?? project.id}`,
            icon: "folder" as const,
            imageUrl: projectIconUrl(workspaceId, project.id, iconVersions[project.id]),
            active: project.id === activeProjectId,
          })),
        }]
      : []),
  ];
}
