import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/app/workspace/workspace-actions";
import { isDevelopmentAuthBypassActive, viewAsModeFor } from "@/src/server/auth-session";
import { ViewAsSwitcher } from "./ViewAsSwitcher";
import { InstallAppButton } from "./InstallAppButton";
import { BrandMark } from "./BrandMark";

export type WorkspaceChoice = {
  id: string;
  name: string;
  role?: string;
};

export type WorkspaceNavItem = {
  label: string;
  href: string;
  icon?: "home" | "grid" | "folder" | "settings";
  active?: boolean;
};

export type WorkspaceNavSection = {
  label: string;
  items: WorkspaceNavItem[];
};

export type WorkspaceBreadcrumb = {
  label: string;
  href?: string;
};

type WorkspaceShellProps = {
  user: { name: string; email: string };
  workspace?: WorkspaceChoice;
  workspaces?: WorkspaceChoice[];
  navSections: WorkspaceNavSection[];
  breadcrumbs: WorkspaceBreadcrumb[];
  headerActions?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
};

function Icon({ name }: { name: WorkspaceNavItem["icon"] }) {
  const common = {
    "aria-hidden": true as const,
    className: "size-4 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.6,
    viewBox: "0 0 20 20",
  };

  if (name === "home") {
    return <svg {...common}><path d="m2.8 9.1 7.2-6 7.2 6" /><path d="M4.7 8.2v8.1h10.6V8.2M8 16.3v-5.1h4v5.1" /></svg>;
  }
  if (name === "folder") {
    return <svg {...common}><path d="M2.8 5.8h5l1.6 1.7h7.8v7.9H2.8z" /><path d="M2.8 5.8V4.6h5.1l1.5 1.2" /></svg>;
  }
  if (name === "settings") {
    return <svg {...common}><circle cx="10" cy="10" r="2.5" /><path d="M10 2.6v1.5m0 11.8v1.5M2.6 10h1.5m11.8 0h1.5M4.8 4.8l1.1 1.1m8.2 8.2 1.1 1.1m0-10.4-1.1 1.1m-8.2 8.2-1.1 1.1" /><circle cx="10" cy="10" r="6.4" /></svg>;
  }
  return <svg {...common}><rect x="3" y="3" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1" /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" /></svg>;
}

function NavigationSections({ sections }: { sections: WorkspaceNavSection[] }) {
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section aria-label={section.label} key={section.label}>
          <h2 className="px-2.5 pb-1.5 text-[12px] font-medium text-foreground-subtle">{section.label}</h2>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={`${item.label}:${item.href}`}>
                <Link
                  aria-current={item.active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-2.5 rounded-control px-2.5 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${item.active ? "workspace-nav-active text-foreground" : "text-foreground-muted hover:bg-surface-inset hover:text-foreground"}`}
                  href={item.href}
                >
                  <Icon name={item.icon} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function WorkspacePicker({ workspace, workspaces = [] }: { workspace?: WorkspaceChoice; workspaces?: WorkspaceChoice[] }) {
  if (!workspace) {
    return (
      <div className="rounded-control border border-border bg-surface px-2.5 py-2">
        <p className="text-[12px] font-medium text-foreground-subtle">Workspace</p>
        <p className="mt-0.5 truncate text-xs font-medium text-foreground">All workspaces</p>
      </div>
    );
  }

  return (
    <details className="group relative">
      <summary aria-label={`Current workspace: ${workspace.name}. Open workspace switcher.`} className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control bg-surface-inset px-2.5 py-2 transition-colors hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-control border border-transparent bg-surface-inset text-[11px] font-semibold text-foreground-muted">{workspace.name.trim().slice(0, 1).toUpperCase() || "W"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{workspace.name}</span>
          <span className="block text-[10px] capitalize text-foreground-subtle">{workspace.role === "reviewer" ? "Product manager / reviewer" : workspace.role ?? "workspace"}</span>
        </span>
        <svg aria-hidden="true" className="size-3.5 shrink-0 text-foreground-subtle transition-transform group-open:rotate-180" fill="none" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
      </summary>
      <nav aria-label="Switch workspace" className="absolute left-0 top-[calc(100%+6px)] dial-popover z-30 w-64 p-1.5">
        <p className="px-2 py-1.5 text-[12px] font-medium text-foreground-subtle">Workspaces</p>
        <ul className="max-h-64 overflow-y-auto">
          {workspaces.map((entry) => (
            <li key={entry.id}>
              <Link aria-current={entry.id === workspace.id ? "page" : undefined} className={`block rounded-control px-2 py-2 text-xs transition-colors hover:bg-surface-raised ${entry.id === workspace.id ? "text-foreground" : "text-foreground-muted hover:text-foreground"}`} href={`/workspace/${entry.id}`}>
                <span className="block truncate font-medium">{entry.name}</span>
                <span className="mt-0.5 block text-[10px] capitalize text-foreground-subtle">{entry.role ?? "member"}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link className="mt-1 block rounded-control border-t border-border px-2 py-2 text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground" href="/workspace">View all workspaces</Link>
      </nav>
    </details>
  );
}

async function SidebarContents({ user, workspace, workspaces, navSections }: Omit<WorkspaceShellProps, "breadcrumbs" | "children" | "headerActions" | "contentClassName">) {
  const devBypass = await isDevelopmentAuthBypassActive();
  return (
    <>
      <Link aria-label="Asbir Handoff home" className="flex h-12 items-center gap-2 border-b border-border px-4" href="/workspace">
        <BrandMark />
      </Link>
      <div className="px-3 pt-3">
        <WorkspacePicker workspace={workspace} workspaces={workspaces} />
      </div>
      <nav aria-label="Workspace navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavigationSections sections={navSections} />
      </nav>
      {devBypass && (workspace?.id ?? workspaces?.[0]?.id) ? (
        <ViewAsSwitcher
          current={viewAsModeFor(user)}
          workspaceId={(workspace?.id ?? workspaces?.[0]?.id)!}
        />
      ) : null}
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex min-w-0 items-center gap-2.5 px-1 py-1">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-raised text-[10px] font-semibold text-foreground">{user.name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-[10px] text-foreground-subtle">{user.email}</span>
          </span>
          <SignOutButton devBypass={devBypass} />
        </div>
      </div>
    </>
  );
}

export function WorkspaceShell({
  user,
  workspace,
  workspaces,
  navSections,
  breadcrumbs,
  headerActions,
  contentClassName,
  children,
}: WorkspaceShellProps) {
  const shellContent: Omit<WorkspaceShellProps, "breadcrumbs" | "children" | "headerActions" | "contentClassName"> = {
    user,
    workspace,
    workspaces,
    navSections,
  };

  return (
    <div className="workspace-shell min-h-screen p-2.5 text-foreground sm:p-3 lg:p-4">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-control focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary-hover"
        href="#main-content"
      >
        Skip to main content
      </a>
      <div className="workspace-window min-h-[calc(100vh-20px)] lg:grid lg:min-h-[calc(100vh-32px)] lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside aria-label="Asbir Handoff workspace" className="workspace-sidebar sticky top-2.5 hidden h-screen min-h-0 flex-col border-r border-border sm:top-3 lg:top-4 lg:flex lg:h-[calc(100vh-32px)]">
          <SidebarContents {...shellContent} />
        </aside>
        <div className="min-w-0">
          <header className="workspace-topbar sticky top-2.5 z-20 flex h-12 items-center justify-between gap-3 border-b border-border px-4 sm:top-3 sm:px-6 lg:top-4">
            <div className="flex min-w-0 items-center gap-3">
              <details className="group relative lg:hidden">
                <summary aria-label="Open workspace navigation" className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-control bg-surface-inset px-2.5 text-xs font-medium text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="grid size-4 grid-cols-2 gap-[2px]"><i className="rounded-[1px] bg-current" /><i className="rounded-[1px] bg-current" /><i className="rounded-[1px] bg-current" /><i className="rounded-[1px] bg-current" /></span>
                  Menu
                </summary>
                <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[min(84vw,300px)] rounded-control border border-border bg-background p-3 shadow-xl shadow-black/30">
                  <SidebarContents {...shellContent} />
                </div>
              </details>
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[12px]">
                {breadcrumbs.map((crumb, index) => (
                  <span className="flex min-w-0 items-center gap-2" key={`${crumb.label}:${index}`}>
                    {index > 0 ? <span aria-hidden="true" className="text-foreground-subtle">/</span> : null}
                    {crumb.href ? <Link className="truncate text-foreground-subtle transition-colors hover:text-foreground" href={crumb.href}>{crumb.label}</Link> : <span aria-current="page" className="truncate font-medium text-foreground">{crumb.label}</span>}
                  </span>
                ))}
              </nav>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <InstallAppButton />
              {headerActions}
            </div>
          </header>
          <div className={contentClassName} id="main-content" tabIndex={-1}>{children}</div>
        </div>
      </div>
    </div>
  );
}
