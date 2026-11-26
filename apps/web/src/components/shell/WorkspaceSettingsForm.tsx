"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useRef, useState, useTransition } from "react";
import { ProjectIcon, squareImage } from "@/src/components/shell/ProjectIcon";
import { showErrorToast, showToast } from "./Toaster";

type Props = {
  workspaceId: string;
  name: string;
  logoUrl: string | null;
  /** Saved domains, or null when the deployment's list applies. */
  domains: string[] | null;
  environmentDomains: string[];
};

const inputClass =
  "h-10 w-full rounded-control bg-surface-inset px-3 text-[13px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

/** Owner settings: workspace name and logo, and which email domains can join without an invite. */
export function WorkspaceSettingsForm({ workspaceId, name: initialName, logoUrl: initialLogo, domains: initialDomains, environmentDomains }: Props) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [logoUrl, setLogoUrl] = useState(initialLogo);
  const [domains, setDomains] = useState<string[]>(initialDomains ?? environmentDomains);
  const [usingEnvironment, setUsingEnvironment] = useState(initialDomains === null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function patch(body: object, key: string) {
    setBusy(key);
    setError("");
    try {
      const response = await fetch(`${base}/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; name?: string; allowedEmailDomains?: string[] | null };
      if (!response.ok) throw new Error(payload.error ?? "Couldn't save.");
      showToast("Saved");
      startRefresh(() => router.refresh());
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if ((await patch({ name }, "name"))) setSavedName(name.trim());
  }

  async function saveDomains(next: string[] | null) {
    const payload = await patch({ allowedEmailDomains: next }, "domains");
    if (!payload) return;
    setUsingEnvironment(payload.allowedEmailDomains === null);
    setDomains(payload.allowedEmailDomains ?? environmentDomains);
  }

  function addDraft() {
    const value = draft.trim().toLowerCase().replace(/^@/, "");
    if (!value) return;
    setDraft("");
    if (!domains.includes(value)) void saveDomains([...domains, value]);
  }

  function onDraftKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addDraft();
    }
  }

  async function uploadLogo(file: File) {
    setBusy("logo");
    setError("");
    try {
      const body = await squareImage(file);
      const response = await fetch(`${base}/logo`, { method: "PUT", headers: { "content-type": body.type }, body });
      const payload = (await response.json().catch(() => ({}))) as { logoVersion?: string; error?: string };
      if (!response.ok || !payload.logoVersion) throw new Error(payload.error ?? "Couldn't upload this image.");
      setLogoUrl(`${base}/logo?v=${payload.logoVersion}`);
      startRefresh(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't upload this image.");
    } finally {
      setBusy(null);
    }
  }

  // Optimistic: the logo goes right away and comes back if the server couldn't remove it.
  async function removeLogo() {
    const previous = logoUrl;
    setBusy("logo");
    setLogoUrl(null);
    const response = await fetch(`${base}/logo`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      setLogoUrl(previous);
      showErrorToast("Couldn't remove the logo. Try again.");
      return;
    }
    startRefresh(() => router.refresh());
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="settings-general" className="workspace-pane p-5 sm:p-6">
        <h2 className="text-[14px] font-semibold text-foreground" id="settings-general">General</h2>
        <div className="mt-5 flex items-center gap-4">
          <button aria-label={logoUrl ? "Change logo" : "Upload a logo"} className="group relative shrink-0 rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={busy === "logo"} onClick={() => fileRef.current?.click()} type="button">
            <ProjectIcon name={savedName} size={56} src={logoUrl} />
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/55 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">{busy === "logo" ? "…" : "Change"}</span>
          </button>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">Logo</p>
            <p className="mt-0.5 text-[12px] text-foreground-subtle">Shown in the sidebar. Square PNG, JPEG or WebP, up to 512 KB.</p>
            <div className="mt-2 flex gap-1.5">
              <button className="dial-button min-h-7 px-2.5 text-[12px]" disabled={busy === "logo"} onClick={() => fileRef.current?.click()} type="button">{logoUrl ? "Change" : "Upload logo"}</button>
              {logoUrl ? <button className="min-h-7 rounded-control px-2.5 text-[12px] text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground" onClick={() => void removeLogo()} type="button">Remove</button> : null}
            </div>
          </div>
          <input accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadLogo(file); }} ref={fileRef} tabIndex={-1} type="file" />
        </div>
        <form className="mt-6" onSubmit={saveName}>
          <label className="block text-[12px] text-foreground-muted" htmlFor="workspace-name">Workspace name</label>
          <div className="mt-1.5 flex gap-2">
            <input className={inputClass} id="workspace-name" maxLength={80} onChange={(event) => setName(event.target.value)} required value={name} />
            <button className="h-10 shrink-0 rounded-control bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50" disabled={busy === "name" || !name.trim() || name.trim() === savedName} type="submit">{busy === "name" ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </section>

      <section aria-labelledby="settings-domains" className="workspace-pane p-5 sm:p-6">
        <h2 className="text-[14px] font-semibold text-foreground" id="settings-domains">Who can join</h2>
        <p className="mt-1.5 text-[13px] leading-5 text-foreground-muted">
          People with a verified email at these domains can sign up and join on their own. Anyone else needs an invite link.
          {domains.length ? null : " With no domains, anyone with an account can sign up."}
        </p>
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {domains.map((domain) => (
            <li className="inline-flex h-8 items-center gap-1 rounded-full bg-white/[0.06] pl-3 pr-1 text-[12px] text-foreground" key={domain}>
              <span className="font-mono">@{domain}</span>
              <button aria-label={`Remove ${domain}`} className="grid size-6 place-items-center rounded-full text-foreground-subtle hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40" disabled={busy === "domains" || domains.length === 1} onClick={() => void saveDomains(domains.filter((item) => item !== domain))} title={domains.length === 1 ? "Keep at least one domain, or reset to the default" : undefined} type="button">
                <svg aria-hidden="true" className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
              </button>
            </li>
          ))}
          <li>
            <label className="sr-only" htmlFor="workspace-domain">Add a domain</label>
            <input className="h-8 w-48 rounded-full bg-surface-inset px-3 font-mono text-[12px] text-foreground outline-none placeholder:font-sans placeholder:text-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" id="workspace-domain" onBlur={addDraft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onDraftKey} placeholder="Add a domain…" value={draft} />
          </li>
        </ul>
        {usingEnvironment ? null : (
          <p className="mt-3 text-[12px] text-foreground-subtle">
            <button className="underline decoration-dotted underline-offset-4 hover:text-foreground" onClick={() => void saveDomains(null)} type="button">Reset to default</button>
            {environmentDomains.length ? ` (${environmentDomains.map((domain) => "@" + domain).join(", ")})` : null}
          </p>
        )}
      </section>

      {error ? <p aria-live="polite" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
