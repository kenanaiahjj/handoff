"use client";

import { useEffect, useRef, useState } from "react";
import {
  versionLabelBase,
  versionLabelMaxLength,
  versionLabelSeparator,
} from "@/src/lib/version-label";

type PendingScreen = { id: string; name: string };

/**
 * Review pending canvas changes and publish them as one new version: a name, a note for reviewers,
 * and the screens that will be removed (each can be kept again here).
 */
export function PublishChangesDialog({
  removedScreens,
  defaultVersionLabel,
  onKeep,
  onClose,
  onPublish,
}: {
  removedScreens: PendingScreen[];
  defaultVersionLabel: string;
  onKeep: (frameId: string) => void;
  onClose: () => void;
  onPublish: (input: { versionLabel: string; releaseNote: string }) => Promise<string | null>;
}) {
  const [versionNumber, setVersionNumber] = useState(() => versionLabelBase(defaultVersionLabel));
  const [versionName, setVersionName] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const normalizedVersionNumber = versionNumber.trim();
  const normalizedVersionName = versionName.trim();
  const versionLabel = normalizedVersionName && normalizedVersionNumber
    ? `${normalizedVersionNumber}${versionLabelSeparator}${normalizedVersionName}`
    : normalizedVersionNumber;
  const versionNameMaxLength = Math.max(0, versionLabelMaxLength - normalizedVersionNumber.length - versionLabelSeparator.length);

  function updateVersionNumber(value: string) {
    setVersionNumber(value);
    const nextNameMaxLength = Math.max(0, versionLabelMaxLength - value.trim().length - versionLabelSeparator.length);
    setVersionName((current) => current.slice(0, nextNameMaxLength));
  }

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, pending]);

  async function publish() {
    setPending(true);
    setError("");
    const failure = await onPublish({ versionLabel: versionLabel.trim(), releaseNote: releaseNote.trim() });
    if (failure) {
      setError(failure);
      setPending(false);
    }
  }

  return (
    <div className="overlay-scrim fixed inset-0 z-[70] grid place-items-center p-4" onClick={() => (pending ? null : onClose())}>
      <div
        aria-labelledby="publish-changes-title"
        aria-modal="true"
        className="w-full max-w-[460px] rounded-[14px] border border-white/[0.08] bg-[#141414] p-5 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.85)]"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <h2 className="text-[15px] font-semibold text-foreground" id="publish-changes-title">Publish a new version</h2>
        <p className="mt-1 text-[12px] leading-5 text-foreground-muted">Reviewers get one update with everything below. Earlier versions stay as they are.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block min-w-0 text-[12px] font-medium text-foreground" htmlFor="publish-version-number">
            Version number
            <input
              className="mt-1.5 h-9 w-full rounded-[8px] border border-white/[0.08] bg-white/[0.03] px-2.5 text-[13px] text-foreground outline-none focus:border-white/25"
              id="publish-version-number"
              maxLength={versionLabelMaxLength}
              onChange={(event) => updateVersionNumber(event.target.value)}
              placeholder="2.0.5"
              value={versionNumber}
            />
          </label>
          <label className="block min-w-0 text-[12px] font-medium text-foreground" htmlFor="publish-version-name">
            Additional name <span className="font-normal text-foreground-subtle">(optional)</span>
            <input
              className="mt-1.5 h-9 w-full rounded-[8px] border border-white/[0.08] bg-white/[0.03] px-2.5 text-[13px] text-foreground outline-none focus:border-white/25 disabled:opacity-50"
              disabled={!versionNameMaxLength}
              id="publish-version-name"
              maxLength={versionNameMaxLength}
              onChange={(event) => setVersionName(event.target.value)}
              placeholder="Edits"
              value={versionName}
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-foreground-subtle">Version label: <span className="font-medium text-foreground-muted">{versionLabel || "Add a version number"}</span></p>

        <label className="mt-3 block text-[12px] font-medium text-foreground" htmlFor="publish-release-note">Note for reviewers <span className="font-normal text-foreground-subtle">(optional)</span></label>
        <textarea
          className="mt-1.5 min-h-20 w-full resize-y rounded-[8px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-[13px] leading-5 text-foreground outline-none placeholder:text-foreground-subtle focus:border-white/25"
          id="publish-release-note"
          maxLength={2000}
          onChange={(event) => setReleaseNote(event.target.value)}
          placeholder="What changed and why"
          value={releaseNote}
        />

        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-subtle">Screens removed · {removedScreens.length}</p>
          <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
            {removedScreens.map((screen) => (
              <li className="flex items-center gap-2 rounded-[8px] bg-white/[0.03] px-2.5 py-1.5" key={screen.id}>
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground line-through decoration-danger/70">{screen.name}</span>
                <button className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] text-foreground-muted hover:bg-white/[0.06] hover:text-foreground" disabled={pending} onClick={() => onKeep(screen.id)} type="button">Keep</button>
              </li>
            ))}
          </ul>
        </div>

        {error ? <p className="mt-3 text-[12px] text-danger" role="alert">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button className="h-9 rounded-[9px] px-3.5 text-[13px] font-medium text-foreground-muted hover:text-foreground" disabled={pending} onClick={onClose} type="button">Cancel</button>
          <button
            className="h-9 rounded-[9px] bg-[#ececec] px-4 text-[13px] font-semibold text-[#141414] transition-colors hover:bg-white disabled:opacity-50"
            disabled={pending || !removedScreens.length || !normalizedVersionNumber || versionLabel.length > versionLabelMaxLength}
            onClick={() => void publish()}
            type="button"
          >
            {pending ? "Publishing…" : "Publish version"}
          </button>
        </div>
      </div>
    </div>
  );
}
