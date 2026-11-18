"use client";

import { useState } from "react";
import { type EditableProfile, ProfileForm } from "@/src/components/profile/ProfileForm";
import { getManualInstallInstructions, useInstallPrompt } from "@/src/components/shell/InstallAppButton";

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <span aria-label={`Step ${step} of ${total}`} className="flex items-center gap-1.5" role="img">
      {Array.from({ length: total }, (_, index) => (
        <span className={"h-1.5 rounded-full transition-all " + (index + 1 === step ? "w-4 bg-foreground" : index + 1 < step ? "w-1.5 bg-foreground/60" : "w-1.5 bg-foreground/20")} key={index} />
      ))}
    </span>
  );
}

const skipClass = "min-h-9 rounded-control px-3 text-[13px] text-foreground-subtle transition-colors hover:bg-white/[0.06] hover:text-foreground";

/** Step 2: name, photo, title and department. Everything is optional except the name. */
export function ProfileStep({ profile, onDone }: { profile: EditableProfile; onDone: () => void }) {
  return (
    <div className="onboarding-panel dial-popover p-5">
      <div className="mb-5 flex items-center justify-between">
        <span className="dial-section-title">Your profile</span>
        <StepDots step={2} total={3} />
      </div>
      <ProfileForm
        compact
        initial={profile}
        onSaved={onDone}
        secondaryAction={<button className={skipClass} onClick={onDone} type="button">Skip for now</button>}
        submitLabel="Save and continue"
      />
    </div>
  );
}

const installReasons = [
  {
    title: "Know when you're needed",
    body: "The app icon shows a count of comments that mention you and still need a reply.",
    icon: <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.3L3.3 10.5h9.4l-1.2-2.2V6A3.5 3.5 0 0 0 8 2.5Zm-1.5 10h3" />,
  },
  {
    title: "Its own window",
    body: "Opens from your Dock, taskbar or home screen, away from your browser tabs.",
    icon: <path d="M2.5 3.5h11v9h-11zM2.5 6h11" />,
  },
  {
    title: "Faster handoffs",
    body: "Screens you've opened are kept on this device, so big canvases open in a moment.",
    icon: <path d="M9 2.5 4 9h4l-1 4.5L12 7H8l1-4.5Z" />,
  },
];

/** Step 3: why the installed app is better than a tab, with a one-click install where the browser allows. */
export function InstallStep({ onDone }: { onDone: () => void }) {
  const { installed, canPrompt, install } = useInstallPrompt();
  const [instructions, setInstructions] = useState("");

  async function installNow() {
    const outcome = await install();
    if (outcome === "manual") setInstructions(getManualInstallInstructions());
  }

  return (
    <div className="onboarding-panel dial-popover p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="dial-section-title">Install Asbir Handoff</span>
        <StepDots step={3} total={3} />
      </div>
      <ul className="space-y-1">
        {installReasons.map((reason) => (
          <li className="flex gap-3 rounded-[10px] px-2 py-2.5" key={reason.title}>
            <span aria-hidden="true" className="onboarding-tile-icon grid size-9 shrink-0 place-items-center rounded-[10px]">
              <svg className="size-[18px]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">{reason.icon}</svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-foreground">{reason.title}</span>
              <span className="mt-0.5 block text-[12px] leading-[1.45] text-foreground-subtle">{reason.body}</span>
            </span>
          </li>
        ))}
      </ul>
      {instructions ? (
        <p className="mt-3 rounded-[10px] bg-white/[0.04] px-3 py-2.5 text-[12px] leading-5 text-foreground-muted" role="status">{instructions}</p>
      ) : null}
      <div className="mt-5 flex items-center justify-end gap-2">
        {installed ? (
          <>
            <p className="mr-auto text-[12px] text-foreground-muted" role="status">Installed. You can open it from your apps.</p>
            <button className="onboarding-continue h-9 rounded-[9px] px-4 text-[13px] font-medium" onClick={onDone} type="button">Continue</button>
          </>
        ) : (
          <>
            <button className={skipClass} onClick={onDone} type="button">Keep using the browser</button>
            <button className="onboarding-continue flex h-9 items-center gap-1.5 rounded-[9px] px-4 text-[13px] font-medium" onClick={() => void installNow()} type="button">
              <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16"><path d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 10.5v2h10v-2" /></svg>
              {canPrompt ? "Install app" : "Show me how"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
