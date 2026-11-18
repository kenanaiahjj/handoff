"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unavailable" | "unsupported" | "blocked" | "off" | "on" | "working";

function base64ToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Turns notifications on for this device (the installed app or this browser). */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const config = await fetch("/api/me/push", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).catch(() => null) as { enabled?: boolean; publicKey?: string | null } | null;
      if (cancelled) return;
      if (!config?.enabled || !config.publicKey) return setState("unavailable");
      if (!supported) return setState("unsupported");
      setPublicKey(config.publicKey);
      if (Notification.permission === "denied") return setState("blocked");
      const registration = await navigator.serviceWorker.getRegistration("/");
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setState(existing ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    if (!publicKey) return;
    setState("working");
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const registration = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) });
      const response = await fetch("/api/me/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
      if (!response.ok) throw new Error();
      setState("on");
    } catch {
      setError("Couldn't turn notifications on.");
      setState("off");
    }
  }

  async function turnOff() {
    setState("working");
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await fetch(`/api/me/push?endpoint=${encodeURIComponent(subscription.endpoint)}`, { method: "DELETE" }).catch(() => undefined);
      await subscription.unsubscribe().catch(() => undefined);
    }
    setState("off");
  }

  if (state === "loading" || state === "unavailable") return null;

  const on = state === "on";
  const detail =
    state === "unsupported" ? "This browser can't show notifications. Install the app to get them."
      : state === "blocked" ? "Blocked in your browser settings for this site."
        : on ? "Mentions and new versions pop up on this device."
          : "Get a notification here when you're mentioned or a handoff you follow changes.";

  return (
    <div className="mt-1 border-t border-white/[0.06] px-1 pb-1 pt-2">
      <div className="flex items-start gap-2.5 px-1.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-foreground">This device</span>
          <span className="block text-[11px] leading-[1.4] text-foreground-subtle">{error || detail}</span>
        </span>
        {state === "unsupported" || state === "blocked" ? null : (
          <button
            aria-checked={on}
            aria-label="Notifications on this device"
            className={"relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 " + (on ? "bg-primary" : "bg-white/[0.12]")}
            disabled={state === "working"}
            onClick={() => void (on ? turnOff() : turnOn())}
            role="switch"
            type="button"
          >
            <span className={"absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] " + (on ? "left-[18px]" : "left-0.5")} />
          </button>
        )}
      </div>
    </div>
  );
}
