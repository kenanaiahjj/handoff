"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/src/client/auth-client";
import { clearDeviceCache } from "@/src/client/device-cache";
import { AuthShell } from "../auth-shell";

export type RoleOption = { id: string; label: string; description: string; manages: boolean };

type OnboardingUser = { name: string; email: string; image: string | null };

/** One monochrome glyph per role; colour comes only from selection. */
const roleIcons: Record<string, React.ReactNode> = {
  designer: <path d="M9.5 3.5 12.5 6.5M3 13l1-3.5L10.5 3a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L6.5 12Z" />,
  dev: <path d="m6 5-3 3 3 3m4-6 3 3-3 3" />,
  qa: <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  pm: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
  marketing: <path d="M3 6.5v3h2l4 2.5v-8L5 6.5H3Zm8.5-.5a3 3 0 0 1 0 4" />,
  exec: <path d="M3 12.5 6.5 8l2.5 2.5L13 5m0 0H9.5M13 5v3.5" />,
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function OnboardingForm({ roles, user, workspaceNames }: { roles: RoleOption[]; user: OnboardingUser; workspaceNames: string[] }) {
  const [jobRole, setJobRole] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const firstName = user.name.split(" ")[0] ?? "";
  const selected = roles.find((role) => role.id === jobRole) ?? null;

  async function submit() {
    if (!jobRole || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobRole }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "We couldn't save your role.");
        setPending(false);
        return;
      }
      window.location.assign(result.redirectTo);
    } catch {
      setError("We couldn't reach the server. Try again.");
      setPending(false);
    }
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  async function switchAccount() {
    await clearDeviceCache();
    await authClient.signOut().catch(() => undefined);
    router.replace("/sign-in");
    router.refresh();
  }

  // Number keys pick a role from anywhere on the page; Enter continues.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < roles.length) {
        setJobRole(roles[index].id);
        rowRefs.current[index]?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roles]);

  // Enter continues from anywhere once a role is picked.
  useEffect(() => {
    function onEnter(event: globalThis.KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || !jobRole || pending) return;
      event.preventDefault();
      void submitRef.current();
    }
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, [jobRole, pending]);

  // Arrow keys move through the radio group, as native radios do.
  function onRowKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      event.preventDefault();
      const next = (index + step + roles.length) % roles.length;
      setJobRole(roles[next].id);
      rowRefs.current[next]?.focus();
    }
  }

  const focusIndex = Math.max(0, roles.findIndex((role) => role.id === jobRole));

  return (
    <AuthShell
      subtitle="Tell us what you do and we’ll set up your view."
      title={firstName ? `Welcome, ${firstName}` : "Welcome to Asbir Handoff"}
      wide
    >
      <div className="onboarding-panel dial-popover overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- Google avatar on its own host.
            <img alt="" className="size-8 shrink-0 rounded-full ring-1 ring-white/10" referrerPolicy="no-referrer" src={user.image} />
          ) : (
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-strong text-[11px] font-semibold text-foreground">
              {initials(user.name) || "?"}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-[12px] text-foreground-subtle">{user.email}</span>
          </span>
          <button
            className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] text-foreground-subtle transition-colors hover:bg-surface-inset hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40"
            onClick={switchAccount}
            type="button"
          >
            Switch account
          </button>
        </div>

        <div className="p-3">
          <div className="flex items-center justify-between px-1 pb-3 pt-1">
            <span className="dial-section-title" id="onboarding-role-label">Your role</span>
            <span className="text-[11px] text-foreground-subtle">
              Press <kbd className="onboarding-kbd">1</kbd>–<kbd className="onboarding-kbd">{roles.length}</kbd>
            </span>
          </div>
          <div aria-labelledby="onboarding-role-label" className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
            {roles.map((role, index) => {
              const isSelected = jobRole === role.id;
              return (
                <button
                  aria-checked={isSelected}
                  className="onboarding-tile group relative flex min-h-[124px] flex-col items-start overflow-hidden rounded-[12px] p-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                  data-selected={isSelected || undefined}
                  key={role.id}
                  onClick={() => setJobRole(role.id)}
                  onDoubleClick={() => void submit()}
                  onKeyDown={(event) => onRowKeyDown(event, index)}
                  ref={(node) => {
                    rowRefs.current[index] = node;
                  }}
                  role="radio"
                  tabIndex={index === focusIndex ? 0 : -1}
                  type="button"
                >
                  <span className="flex w-full items-start justify-between">
                    <span aria-hidden="true" className="onboarding-tile-icon grid size-9 place-items-center rounded-[10px]">
                      <svg className="size-[18px]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
                        {roleIcons[role.id]}
                      </svg>
                    </span>
                    <span aria-hidden="true" className="relative grid size-5 place-items-center">
                      <kbd className="onboarding-kbd onboarding-tile-key">{index + 1}</kbd>
                      <span className="onboarding-check absolute inset-0 grid place-items-center rounded-full">
                        <svg className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 12 12">
                          <path d="M2.5 6.2 4.9 8.5 9.5 3.5" />
                        </svg>
                      </span>
                    </span>
                  </span>
                  <span className="block pt-5 text-[13px] font-medium leading-tight text-foreground">{role.label}</span>
                  <span className="mt-1 line-clamp-2 block text-[12px] leading-[1.4] text-foreground-subtle">{role.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-t border-border bg-white/[0.02] px-4 py-3">
          {workspaceNames.length ? (
            <p className="min-w-0 text-[12px] text-foreground-muted">
              {selected?.manages
                ? "You’ll be able to create projects and publish handoffs."
                : "You’ll see the projects and handoffs your team shares with you."}
            </p>
          ) : (
            <p className="text-[12px] text-foreground-muted">Ask a designer for an invite link to see your team’s handoffs.</p>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-[10px] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-5 text-foreground" role="alert">{error}</p>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-4 px-1">
        <p aria-live="polite" className="min-w-0 text-[12px] text-foreground-subtle">
          {pending ? (
            "Setting things up…"
          ) : selected ? (
            <>
              Press <kbd className="onboarding-kbd">↵</kbd> to continue as {selected.label}
            </>
          ) : (
            "Pick the closest match. You can only choose one."
          )}
        </p>
        <button
          className="onboarding-continue group flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] px-4 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
          disabled={!selected || pending}
          onClick={submit}
          type="button"
        >
          {pending ? <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70" /> : null}
          Continue
          {pending ? null : (
            <svg aria-hidden="true" className="size-3.5 transition-transform group-enabled:group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 16 16">
              <path d="M3.5 8h9m-3.5-3.5L12.5 8 9 11.5" />
            </svg>
          )}
        </button>
      </div>
    </AuthShell>
  );
}
