"use client";

import { useEffect, useState } from "react";

const eventName = "asbir:toast";

type ToastItem = { id: number; message: string; leaving: boolean };

/** Shows a short success message at the bottom of the screen. Safe to call right before a navigation. */
export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: message }));
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
      const message = (event as CustomEvent<string>).detail;
      const id = ++nextId;
      setToasts((current) => [...current.slice(-2), { id, message, leaving: false }]);
      later(() => setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))), 3600);
      later(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3800);
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
        <div className="app-toast pointer-events-auto flex max-w-[min(92vw,420px)] items-center gap-2.5 rounded-full bg-primary py-2.5 pl-3 pr-4 text-[13px] font-semibold text-primary-foreground shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)]" data-leaving={toast.leaving || undefined} key={toast.id}>
          <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-white">
            <svg className="size-3" fill="none" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
          </span>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
