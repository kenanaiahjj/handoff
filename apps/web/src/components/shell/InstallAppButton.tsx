"use client";

import { useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallAppButtonProps = {
  compact?: boolean;
};

function getManualInstallInstructions() {
  const userAgent = navigator.userAgent;
  const isMac = /Macintosh|Mac OS X/.test(userAgent);
  const isWindows = /Windows/.test(userAgent);
  const isEdge = /Edg\//.test(userAgent);
  const isChrome = /(Chrome|Chromium|CriOS)/.test(userAgent) && !isEdge;
  const isSafari = /Safari/.test(userAgent) && !/(Chrome|Chromium|CriOS|Edg)/.test(userAgent);

  if (isMac && isSafari) {
    return "In Safari, select Share in the toolbar, then choose Add to Dock. macOS adds Asbir Handoff to the Dock and Spotlight.";
  }

  if (isEdge) {
    return "In Microsoft Edge, open Settings and more, then choose More tools > Apps > Install this site as an app.";
  }

  if (isChrome) {
    return "In Chrome, select Install in the address bar. If it isn't shown, open More > Cast, save, and share > Install page as app.";
  }

  if (isMac) {
    return "In Safari, select Share in the toolbar, then choose Add to Dock. In Chrome or Microsoft Edge, open the browser menu and choose its install option.";
  }

  if (isWindows) {
    return "In Microsoft Edge, choose More tools > Apps > Install this site as an app. In Chrome, choose Install in the address bar or Install page as app from the menu.";
  }

  return "Open this page in Safari, Chrome, or Microsoft Edge, then choose the browser's option to add or install the site as an app.";
}

export function InstallAppButton({ compact = false }: InstallAppButtonProps) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const standaloneDisplay = window.matchMedia("(display-mode: standalone)");
    const updateInstalledState = () => {
      const safariStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setInstalled(standaloneDisplay.matches || safariStandalone);
    };
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", onAppInstalled as EventListener);
    standaloneDisplay.addEventListener("change", updateInstalledState);
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    updateInstalledState();

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", onAppInstalled as EventListener);
      standaloneDisplay.removeEventListener("change", updateInstalledState);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (instructionsOpen && !dialog.open) dialog.showModal();
    if (!instructionsOpen && dialog.open) dialog.close();
  }, [instructionsOpen]);

  async function installApp() {
    if (!installPrompt) {
      setInstructions(getManualInstallInstructions());
      setInstructionsOpen(true);
      return;
    }

    const prompt = installPrompt;
    setInstallPrompt(null);
    try {
      const result = await prompt.prompt();
      if (result.outcome === "accepted") setInstalled(true);
    } catch {
      setInstructions(getManualInstallInstructions());
      setInstructionsOpen(true);
    }
  }

  if (installed) return null;

  return (
    <>
      <button
        aria-label="Install Asbir Handoff"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-border px-2.5 text-[11px] text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => void installApp()}
        title="Install Asbir Handoff as an app"
        type="button"
      >
        <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
          <path d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 10.5v2h10v-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
        </svg>
        <span>{compact ? "Install" : "Install app"}</span>
      </button>
      <dialog
        aria-labelledby="install-app-title"
        className="m-auto w-[min(92vw,420px)] rounded-panel border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/65"
        onClose={() => setInstructionsOpen(false)}
        ref={dialogRef}
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-subtle">Asbir Handoff</p>
              <h2 className="mt-1 text-[15px] font-semibold" id="install-app-title">Install this app</h2>
            </div>
            <button
              aria-label="Close install instructions"
              className="grid size-7 place-items-center rounded-control text-lg leading-none text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => setInstructionsOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <p className="mt-3 text-[12px] leading-5 text-foreground-muted">{instructions}</p>
          <p className="mt-2 text-[11px] leading-5 text-foreground-subtle">The browser adds Asbir Handoff to your device and opens it in its own app window.</p>
          <div className="mt-5 flex justify-end">
            <button
              className="min-h-8 rounded-control bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => setInstructionsOpen(false)}
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
