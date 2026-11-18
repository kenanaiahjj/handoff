"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** A time in the viewer's own time zone (the server would otherwise render it in UTC). */
export function LocalTime({ iso, format }: { iso: string; format: "time" | "day" }) {
  const text = useSyncExternalStore(
    subscribe,
    () => {
      const date = new Date(iso);
      if (format === "time") return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (date.toDateString() === today.toDateString()) return "Today";
      if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
      return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    },
    () => (format === "time" ? "" : new Date(iso).toISOString().slice(0, 10)),
  );
  return <>{text}</>;
}
