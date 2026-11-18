"use client";

import { useEffect, useState } from "react";
import { PushToggle } from "./PushToggle";

type SlackPreference = "all" | "mentions" | "off";

const options: Array<{ value: SlackPreference; label: string; detail: string }> = [
  { value: "all", label: "All updates", detail: "New versions and mentions" },
  { value: "mentions", label: "Mentions only", detail: "When someone @mentions you" },
  { value: "off", label: "Off", detail: "No notifications" },
];

/** What to be notified about (Slack and push follow the same choice), plus push for this device. */
export function NotificationSettings() {
  const [value, setValue] = useState<SlackPreference | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/notifications", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { slack?: SlackPreference } | null) => {
        if (!cancelled) setValue(payload?.slack ?? "all");
      })
      .catch(() => {
        if (!cancelled) setValue("all");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(next: SlackPreference) {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      const response = await fetch("/api/me/notifications", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slack: next }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setValue(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-1 py-1">
      <p className="px-1.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-foreground-subtle" id="slack-notifications-label">
        Notify me about
      </p>
      <div aria-busy={saving} aria-labelledby="slack-notifications-label" className="space-y-0.5" role="radiogroup">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              aria-checked={selected}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left transition-colors hover:bg-surface-inset disabled:opacity-60"
              disabled={value === null}
              key={option.value}
              onClick={() => void choose(option.value)}
              role="radio"
              type="button"
            >
              <span aria-hidden="true" className={"grid size-3.5 shrink-0 place-items-center rounded-full border " + (selected ? "border-foreground" : "border-border-strong")}>
                {selected ? <span className="size-1.5 rounded-full bg-foreground" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] text-foreground">{option.label}</span>
                <span className="block text-[11px] text-foreground-subtle">{option.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      <PushToggle />
    </div>
  );
}
