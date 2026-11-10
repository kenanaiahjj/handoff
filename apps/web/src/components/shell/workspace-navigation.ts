import type { WorkspaceNavSection } from "./WorkspaceShell";

type WorkspaceNavigationProject = { id: string; name: string };
type WorkspacePage = "overview" | "project" | "integrations";

export function createWorkspaceNavigation({
  workspaceId,
  projects,
  page,
  activeProjectId,
}: {
  workspaceId: string;
  projects: WorkspaceNavigationProject[];
  page: WorkspacePage;
  activeProjectId?: string;
}): WorkspaceNavSection[] {
  return [
    {
      label: "Workspace",
      items: [
        { label: "Overview", href: `/workspace/${workspaceId}`, icon: "home", active: page === "overview" },
        { label: "Projects", href: `/workspace/${workspaceId}#projects`, icon: "grid" },
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
