"use client";

import { type FormEvent, useState } from "react";
import { useConfirm } from "@/src/components/ConfirmDialog";
import type { Superadmin } from "@/src/server/services/superadmins";

/** Main-screen panel where super admins add or remove people who own every workspace. */
export function SuperadminsPanel({ initial, currentEmail }: { initial: Superadmin[]; currentEmail: string }) {
  const [superadmins, setSuperadmins] = useState(initial);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState("");
  const [message, setMessage] = useState("");
  const { confirm, dialog } = useConfirm();

  async function send(method: "POST" | "DELETE", target: string) {
    const response = await fetch("/api/superadmins", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: target }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "Something went wrong. Try again.");
    setSuperadmins(result.superadmins);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;
    setPending(true);
    setMessage("");
    try {
      await send("POST", target);
      setEmail("");
      setMessage(`${target} is now an admin. They get access the next time they sign in.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function remove(target: string) {
    const confirmed = await confirm({
      title: "Remove admin?",
      description: `${target} will no longer be an admin. Their current role in the workspace stays until you change it.`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    setRemoving(target);
    setMessage("");
    try {
      await send("DELETE", target);
      setMessage(`${target} is no longer an admin.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setRemoving("");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-5 text-foreground-muted">
        Admins manage every project and can invite people. They can sign in from any email domain.
      </p>
      <ul className="space-y-1">
        {superadmins.map((admin) => {
          const isYou = admin.email === currentEmail.toLowerCase();
          return (
            <li className="dial-row flex items-center gap-2.5 px-2.5 py-2" key={admin.email}>
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-strong text-[10px] font-semibold">
                {(admin.name ?? admin.email).trim().slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">
                  {admin.name ?? admin.email}
                  {isYou ? <span className="ml-1.5 font-normal text-foreground-subtle">(you)</span> : null}
                </span>
                <span className="block truncate text-[11px] text-foreground-subtle">
                  {admin.name ? `${admin.email} · ` : ""}
                  {admin.hasSignedIn ? "Active" : "Invited, hasn’t signed in yet"}
                </span>
              </span>
              {isYou ? null : (
                <button
                  className="dial-button min-h-7 shrink-0 px-2.5 text-[11px]"
                  disabled={removing === admin.email}
                  onClick={() => remove(admin.email)}
                  type="button"
                >
                  {removing === admin.email ? "Removing…" : "Remove"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <form className="flex gap-2" onSubmit={add}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Email</span>
          <input
            autoComplete="off"
            className="h-9 w-full rounded-control border border-transparent bg-surface-inset px-3 text-[12px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:border-primary-hover"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@lmf.ventures"
            required
            type="email"
            value={email}
          />
        </label>
        <button className="dial-button min-h-9 shrink-0 px-3 text-[12px]" disabled={pending} type="submit">
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {message ? <p aria-live="polite" className="text-[12px] leading-5 text-foreground-muted">{message}</p> : null}
      {dialog}
    </div>
  );
}
