import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { SignOutButton } from "@/app/workspace/workspace-actions";
import { isDevelopmentAuthBypassEnabled } from "@/src/server/auth-session";
import { InstallAppButton } from "./InstallAppButton";

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
          <h2 className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#929292]">{section.label}</h2>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={`${item.label}:${item.href}`}>
                <Link
                  aria-current={item.active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-2.5 rounded-[5px] px-2.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#aaa] ${item.active ? "bg-[#303030] text-[#ededed]" : "text-[#b0b0b0] hover:bg-[#303030]/70 hover:text-white"}`}
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
      <div className="rounded-[5px] border border-[#383838] bg-[#242424] px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-[0.1em] text-[#929292]">Workspace</p>
        <p className="mt-0.5 truncate text-xs font-medium text-[#dedede]">All team spaces</p>
      </div>
    );
  }

  return (
    <details className="group relative">
      <summary aria-label={`Current workspace: ${workspace.name}. Open workspace switcher.`} className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[5px] border border-[#383838] bg-[#242424] px-2.5 py-2 transition-colors hover:bg-[#303030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#aaa] [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-[5px] border border-[#383838] bg-[#171717] text-[11px] font-semibold text-[#b0b0b0]">{workspace.name.trim().slice(0, 1).toUpperCase() || "W"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{workspace.name}</span>
          <span className="block text-[10px] text-[#929292]">{workspace.role === "reviewer" ? "Product manager / reviewer" : workspace.role ?? "workspace"}</span>
        </span>
        <svg aria-hidden="true" className="size-3.5 shrink-0 text-[#929292] transition-transform group-open:rotate-180" fill="none" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
      </summary>
      <nav aria-label="Switch workspace" className="absolute left-0 top-[calc(100%+6px)] z-30 w-64 rounded-[6px] border border-[#383838] bg-[#242424] p-1.5 shadow-xl shadow-black/30">
        <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#929292]">Your workspaces</p>
        <ul className="max-h-64 overflow-y-auto">
          {workspaces.map((entry) => (
            <li key={entry.id}>
              <Link aria-current={entry.id === workspace.id ? "page" : undefined} className={`block rounded-[5px] px-2 py-2 text-xs transition-colors hover:bg-[#303030] ${entry.id === workspace.id ? "text-[#ededed]" : "text-[#b0b0b0] hover:text-white"}`} href={`/workspace/${entry.id}`}>
                <span className="block truncate font-medium">{entry.name}</span>
                <span className="mt-0.5 block text-[10px] capitalize text-[#929292]">{entry.role ?? "member"}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link className="mt-1 block rounded-[5px] border-t border-[#383838] px-2 py-2 text-xs text-[#b0b0b0] hover:bg-[#303030] hover:text-white" href="/workspace">View all workspaces</Link>
      </nav>
    </details>
  );
}

function SidebarContents({ user, workspace, workspaces, navSections }: Omit<WorkspaceShellProps, "breadcrumbs" | "children" | "headerActions" | "contentClassName">) {
  return (
    <>
      <Link aria-label="Asbir Handoff home" className="flex h-12 items-center gap-2 border-b border-[#383838] px-4" href="/workspace">
        <Image alt="" aria-hidden="true" className="size-6 rounded-[5px] object-cover" height={24} src="/icons/asbir-handoff-v2-180.png" width={24} />
        <span className="text-xs font-semibold tracking-[0.04em] text-[#ededed]">ASBIR <span className="font-normal text-[#929292]">/ HANDOFF</span></span>
      </Link>
      <div className="px-3 pt-3">
        <WorkspacePicker workspace={workspace} workspaces={workspaces} />
      </div>
      <nav aria-label="Workspace navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavigationSections sections={navSections} />
      </nav>
      <div className="border-t border-[#383838] p-3">
        <div className="flex min-w-0 items-center gap-2.5 px-1 py-1">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border border-[#383838] bg-[#303030] text-[10px] font-semibold text-[#ccc]">{user.name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-[#dedede]">{user.name}</span>
            <span className="block truncate text-[10px] text-[#929292]">{user.email}</span>
          </span>
          <SignOutButton hidden={isDevelopmentAuthBypassEnabled()} />
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
    <div className="min-h-screen bg-[#202020] text-[#dedede] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-[5px] focus:bg-[#ededed] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#111] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[#65a854]"
        href="#main-content"
      >
        Skip to main content
      </a>
      <aside aria-label="Asbir Handoff workspace" className="sticky top-0 hidden h-screen min-h-0 flex-col border-r border-[#383838] bg-[#1e1e1e] lg:flex">
        <SidebarContents {...shellContent} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-[#383838] bg-[#202020]/95 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <details className="group relative lg:hidden">
              <summary aria-label="Open workspace navigation" className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[5px] border border-[#383838] bg-[#303030] px-2.5 text-xs text-[#b0b0b0] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#aaa] [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="grid size-4 grid-cols-2 gap-[2px]"><i className="rounded-[1px] bg-current" /><i className="rounded-[1px] bg-current" /><i className="rounded-[1px] bg-current" /><i className="rounded-[1px] bg-current" /></span>
                Menu
              </summary>
              <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[min(84vw,300px)] rounded-[6px] border border-[#383838] bg-[#1e1e1e] p-3 shadow-xl shadow-black/30">
                <SidebarContents {...shellContent} />
              </div>
            </details>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[12px]">
              {breadcrumbs.map((crumb, index) => (
                <span className="flex min-w-0 items-center gap-2" key={`${crumb.label}:${index}`}>
                  {index > 0 ? <span aria-hidden="true" className="text-[#929292]">/</span> : null}
                  {crumb.href ? <Link className="truncate text-[#929292] transition-colors hover:text-white" href={crumb.href}>{crumb.label}</Link> : <span aria-current="page" className="truncate font-medium text-[#dedede]">{crumb.label}</span>}
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
  );
}
