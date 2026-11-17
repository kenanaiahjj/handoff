import { projectIconUrl, projectIconVersions } from "@/src/server/services/project-icons";
import type { WorkspaceNavSection } from "./WorkspaceShell";

type WorkspaceNavigationProject = { id: string; name: string };
type WorkspacePage = "overview" | "projects" | "project" | "integrations";

export async function createWorkspaceNavigation({
  workspaceId,
  companyName,
  projects,
  page,
  activeProjectId,
}: {
  workspaceId: string;
  /** The team's name, e.g. "Asbir Tech", shown above the main links. */
  companyName?: string;
  projects: WorkspaceNavigationProject[];
  page: WorkspacePage;
  activeProjectId?: string;
}): Promise<WorkspaceNavSection[]> {
  const iconVersions = projects.length ? await projectIconVersions(workspaceId) : {};
  return [
    {
      label: companyName ?? "Main",
      hideLabel: !companyName,
      items: [
        { label: "Projects", href: `/workspace/${workspaceId}`, icon: "home", active: page === "overview" || page === "projects" },
        { label: "Integrations", href: `/workspace/${workspaceId}/integrations`, icon: "settings", active: page === "integrations" },
      ],
    },
    ...(projects.length
      ? [{
          label: "Projects",
          items: projects.map((project) => ({
            label: project.name,
            href: `/workspace/${workspaceId}/projects/${project.id}`,
            icon: "folder" as const,
            imageUrl: projectIconUrl(workspaceId, project.id, iconVersions[project.id]),
            active: project.id === activeProjectId,
          })),
        }]
      : []),
  ];
}
