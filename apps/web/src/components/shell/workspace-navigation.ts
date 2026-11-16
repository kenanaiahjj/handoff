import type { WorkspaceNavSection } from "./WorkspaceShell";

type WorkspaceNavigationProject = { id: string; name: string };
type WorkspacePage = "overview" | "projects" | "project" | "integrations";

export function createWorkspaceNavigation({
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
}): WorkspaceNavSection[] {
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
            active: project.id === activeProjectId,
          })),
        }]
      : []),
  ];
}
