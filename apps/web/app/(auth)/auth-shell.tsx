import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Centered, cardless layout shared by sign-in and onboarding: the app icon over a soft warm glow,
 * a heading, the page's content, and an optional footnote pinned to the bottom.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footnote,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
  /** Wider column for richer content such as onboarding. */
  wide?: boolean;
}) {
  return (
    <main className="auth-shell relative isolate flex min-h-dvh flex-col overflow-hidden bg-background px-4">
      <div aria-hidden="true" className="auth-shell-glow pointer-events-none absolute inset-0 -z-10">
        <span className="auth-shell-orb auth-shell-orb-a" />
        <span className="auth-shell-orb auth-shell-orb-b" />
        <span className="auth-shell-orb auth-shell-orb-c" />
        <span className="auth-shell-orb auth-shell-orb-d" />
      </div>
      <div aria-hidden="true" className="auth-shell-grid pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden="true" className="auth-shell-grain pointer-events-none absolute inset-0 -z-10" />

      <div className="flex flex-1 items-center justify-center py-16">
        <div className={"auth-shell-enter w-full " + (wide ? "max-w-[560px]" : "max-w-[360px]")}>
          <Link aria-label="Asbir Handoff home" className="mx-auto block w-fit rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" href="/">
            <Image
              alt=""
              className="auth-shell-icon size-12 rounded-[14px]"
              height={48}
              priority
              src="/icons/asbir-handoff-v2-180.png"
              width={48}
            />
          </Link>
          <h1 className="mt-7 text-balance text-center text-[22px] font-semibold leading-tight tracking-[-0.02em] text-foreground">{title}</h1>
          {subtitle ? <p className="mt-2 text-pretty text-center text-[14px] leading-6 text-foreground-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
        </div>
      </div>

      {footnote ? <p className="pb-8 text-center text-[12px] leading-5 text-foreground-subtle">{footnote}</p> : null}
    </main>
  );
}
