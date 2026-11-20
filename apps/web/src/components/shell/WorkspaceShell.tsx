import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/app/workspace/workspace-actions";
import { isDevelopmentAuthBypassActive, viewAsModeFor } from "@/src/server/auth-session";
import { ViewAsSwitcher } from "./ViewAsSwitcher";
import { QuickOpen } from "./QuickOpen";
import { SearchButton } from "./SearchButton";
import { InstallAppButton } from "./InstallAppButton";
import { BrandMark } from "./BrandMark";
import { ProjectIcon } from "./ProjectIcon";
import { HandoffTabs } from "./HandoffTabs";
import { SidebarToggle } from "./SidebarToggle";
import { NotificationSettingsButton } from "./NotificationSettingsButton";
import { WhatsNewButton } from "./WhatsNew";
import { Avatar } from "@/src/components/Avatar";
import { getDatabase } from "@/src/server/db";
import { workspaceRoleLabel } from "@/src/lib/team-roles";

export type WorkspaceChoice = {
  id: string;
  name: string;
  role?: string;
};

export type WorkspaceNavItem = {
  label: string;
  href: string;
  icon?: "home" | "grid" | "folder" | "settings" | "users" | "activity" | "plug";
  /** A project's uploaded icon, shown instead of the folder. */
  imageUrl?: string | null;
  active?: boolean;
};

export type WorkspaceNavSection = {
  label: string;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  /** A small logo shown before the label (the workspace logo). */
  imageUrl?: string | null;
  items: WorkspaceNavItem[];
};

export type WorkspaceBreadcrumb = {
  label: string;
  href?: string;
};

type WorkspaceShellProps = {
  /** image: photo URL when the page already has it; otherwise it is looked up. */
  user: { name: string; email: string; image?: string | null };
  workspace?: WorkspaceChoice;
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
  if (name === "users") {
    return <svg {...common}><circle cx="7.5" cy="7" r="2.6" /><path d="M2.8 16c.4-2.6 2.3-4.2 4.7-4.2s4.3 1.6 4.7 4.2" /><path d="M12.6 4.6a2.6 2.6 0 0 1 0 4.9M14.3 11.9c1.6.5 2.6 1.9 2.9 4.1" /></svg>;
  }
  if (name === "activity") {
    return <svg {...common}><path d="M2.8 10h3l2-5 4 10 2-5h3.4" /></svg>;
  }
  if (name === "plug") {
    return <svg {...common}><path d="M7 2.8v3.4M13 2.8v3.4M5 6.2h10v3a5 5 0 0 1-10 0zM10 14.2v3" /></svg>;
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
          {section.hideLabel ? null : (
            <h2 className="flex items-center gap-2 px-2.5 pb-1.5 text-[12px] font-medium text-foreground-subtle">
              {/* eslint-disable-next-line @next/next/no-img-element -- small logo from our own route. */}
              {section.imageUrl ? <img alt="" className="size-4 rounded-[4px] object-cover" height={16} src={section.imageUrl} width={16} /> : null}
              {section.label}
            </h2>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={`${item.label}:${item.href}`}>
                <Link
                  aria-current={item.active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-2.5 rounded-control px-2.5 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${item.active ? "workspace-nav-active text-foreground" : "text-foreground-muted hover:bg-surface-inset hover:text-foreground"}`}
                  href={item.href}
                >
                  {item.imageUrl ? <ProjectIcon name={item.label} size={18} src={item.imageUrl} /> : <Icon name={item.icon} />}
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

async function SidebarContents({ user, workspace, navSections }: Omit<WorkspaceShellProps, "breadcrumbs" | "children" | "headerActions" | "contentClassName">) {
  const devBypass = await isDevelopmentAuthBypassActive();
  const image = user.image !== undefined
    ? user.image
    : ((await getDatabase().prepare(`SELECT image FROM "user" WHERE email = ?`).get(user.email)) as { image: string | null } | undefined)?.image ?? null;
  const roleLabel = workspace?.role ? workspaceRoleLabel(workspace.role) : null;
  const subtitle = roleLabel ?? user.email;
  return (
    <>
      <Link aria-label="Asbir Handoff home" className="flex h-12 items-center gap-2 px-4" href="/workspace">
        <BrandMark />
      </Link>
      {workspace?.id ? <div className="px-3 pt-1"><SearchButton /></div> : null}
      <nav aria-label="Workspace navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavigationSections sections={navSections} />
      </nav>
      {devBypass && workspace?.id ? (
        <ViewAsSwitcher
          current={viewAsModeFor(user)}
          workspaceId={workspace.id}
        />
      ) : null}
      <div className="p-2">
        <div className="flex min-w-0 items-center gap-0.5 rounded-[10px] bg-white/[0.03] p-1">
          {(() => {
            const identity = (
              <>
                <Avatar name={user.name} size={30} src={image} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium leading-4 text-foreground">{user.name}</span>
                  <span className="block truncate text-[11px] leading-4 text-foreground-subtle">{subtitle}</span>
                </span>
              </>
            );
            return workspace?.id ? (
              <Link
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[8px] px-1.5 py-1 transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                href={`/profile`}
                title="Your profile"
              >
                {identity}
              </Link>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1">{identity}</span>
            );
          })()}
          <WhatsNewButton />
          <NotificationSettingsButton />
          <SignOutButton devBypass={devBypass} icon />
        </div>
      </div>
    </>
  );
}

export function WorkspaceShell({
  user,
  workspace,
  navSections,
  breadcrumbs,
  headerActions,
  contentClassName,
  children,
}: WorkspaceShellProps) {
  const shellContent: Omit<WorkspaceShellProps, "breadcrumbs" | "children" | "headerActions" | "contentClassName"> = {
    user,
    workspace,
      navSections,
  };

  return (
    <div className="workspace-shell min-h-screen text-foreground sm:p-3 lg:p-4">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-control focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary-hover"
        href="#main-content"
      >
        Skip to main content
      </a>
      {workspace?.id ? <QuickOpen endpoint={`/api/workspaces/${encodeURIComponent(workspace.id)}/search`} /> : null}
      <div className="workspace-window min-h-screen sm:min-h-[calc(100vh-24px)] md:grid md:grid-cols-[232px_minmax(0,1fr)] lg:min-h-[calc(100vh-32px)]">
        <aside aria-label="Asbir Handoff" className="workspace-sidebar sticky top-0 hidden h-screen min-h-0 flex-col border-r border-border sm:top-3 sm:h-[calc(100vh-24px)] md:flex lg:top-4 lg:h-[calc(100vh-32px)]">
          <SidebarContents {...shellContent} />
        </aside>
        <div className="min-w-0">
          {/* The open-handoff tabs and the breadcrumb bar stick together, so the tabs never slide under the bar. */}
          <div className="workspace-topbar workspace-sticky-top sticky top-0 z-20 sm:top-3 lg:top-4">
          <HandoffTabs current={null} homeHref="/workspace" />
          <header className="flex h-12 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarToggle />
              <details className="workspace-menu group relative md:hidden">
                <summary aria-label="Open navigation" className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-control bg-surface-inset px-2.5 text-xs font-medium text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
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
          </div>
          <div className={contentClassName} id="main-content" tabIndex={-1}>{children}</div>
        </div>
      </div>
    </div>
  );
}
