"use client";

import { useEffect, useState } from "react";

const eventName = "asbir:toast";

type ToastTone = "success" | "error";
type ToastItem = { id: number; message: string; tone: ToastTone; leaving: boolean };

/** Shows a short message at the bottom of the screen. Safe to call right before a navigation. */
export function showToast(message: string, tone: ToastTone = "success") {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { message, tone } }));
}

/** Shows a short error, e.g. when an action that already showed as done is rolled back. */
export function showErrorToast(message: string) {
  showToast(message, "error");
}

/** Mounted once in the root layout so a toast survives client-side navigation. */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let nextId = 0;
    const timers = new Set<number>();
    function later(fn: () => void, ms: number) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    }
    function onToast(event: Event) {
      const { message, tone } = (event as CustomEvent<{ message: string; tone: ToastTone }>).detail;
      const id = ++nextId;
      // Errors stay up a little longer so they can be read.
      const visibleFor = tone === "error" ? 5200 : 3600;
      setToasts((current) => [...current.slice(-2), { id, message, tone, leaving: false }]);
      later(() => setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))), visibleFor);
      later(() => setToasts((current) => current.filter((toast) => toast.id !== id)), visibleFor + 200);
    }
    window.addEventListener(eventName, onToast);
    return () => {
      window.removeEventListener(eventName, onToast);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 px-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:pb-6" role="status">
      {toasts.map((toast) => (
        <div className="app-toast dark-toast toast-surface pointer-events-auto" data-leaving={toast.leaving || undefined} data-tone={toast.tone} key={toast.id}>
          <span aria-hidden="true" className="dark-toast-icon">
            {toast.tone === "error" ? (
              <svg className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="M8 4.5v4M8 11.25v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" /></svg>
            ) : (
              <svg className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="m3.75 8.25 2.75 2.75 5.75-6.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" /></svg>
            )}
          </span>
          <span className="dark-toast-title whitespace-normal">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
