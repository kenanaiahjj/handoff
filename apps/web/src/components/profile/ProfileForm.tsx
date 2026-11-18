"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { Avatar } from "@/src/components/Avatar";
import { squareImage } from "@/src/components/shell/ProjectIcon";
import { departmentSuggestions, profileLimits, type ProfileAbout } from "@/src/lib/profile-fields";

export type EditableProfile = ProfileAbout & { name: string; email: string; image: string | null; providerImage?: string | null };

type ProfileFormProps = {
  initial: EditableProfile;
  /** Compact keeps to name, title and department, using the sign-in photo as is (onboarding). */
  compact?: boolean;
  submitLabel?: string;
  onSaved?: (profile: EditableProfile) => void;
  /** Extra buttons beside Save, such as Skip. */
  secondaryAction?: React.ReactNode;
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-control bg-surface-inset px-3 text-[13px] text-foreground outline-none placeholder:text-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** Photo, name and what people show their team. Saves to /api/profile and /api/profile/avatar. */
export function ProfileForm({ initial, compact = false, submitLabel = "Save profile", onSaved, secondaryAction }: ProfileFormProps) {
  const id = useId();
  const [image, setImage] = useState(initial.image);
  // The Google picture an upload replaced; removing the upload goes back to it.
  const [providerImage, setProviderImage] = useState(initial.providerImage ?? null);
  const isUploaded = Boolean(image?.startsWith("/api/users/"));
  const [fields, setFields] = useState({
    name: initial.name,
    title: initial.title ?? "",
    department: initial.department ?? "",
    pronouns: initial.pronouns ?? "",
    timezone: initial.timezone ?? "",
    bio: initial.bio ?? "",
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) => {
    setNotice("");
    setFields((current) => ({ ...current, [key]: event.target.value }));
  };

  async function uploadPhoto(file: File) {
    setPhotoBusy(true);
    setError("");
    try {
      const body = await squareImage(file);
      const response = await fetch("/api/profile/avatar", { method: "PUT", headers: { "content-type": body.type }, body });
      const payload = (await response.json().catch(() => ({}))) as { image?: string; error?: string };
      if (!response.ok || !payload.image) throw new Error(payload.error ?? "Could not upload this photo.");
      if (image && !image.startsWith("/api/users/") && !providerImage) setProviderImage(image);
      setImage(payload.image);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload this photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { image?: string | null };
      if (!response.ok) throw new Error("Could not remove the photo.");
      setImage(payload.image ?? null);
      setProviderImage(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = compact
        ? { name: fields.name, title: fields.title, department: fields.department, timezone: fields.timezone || detectTimezone() }
        : fields;
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save your profile.");
      setNotice("Saved.");
      onSaved?.({ ...initial, ...fields, image, title: fields.title || null, department: fields.department || null, pronouns: fields.pronouns || null, timezone: fields.timezone || null, bio: fields.bio || null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={save}>
      {compact ? (
        <div className="flex items-center gap-3 rounded-[10px] bg-white/[0.03] px-3 py-2.5">
          <Avatar name={fields.name || initial.email} size={36} src={image} />
          <p className="min-w-0 text-[12px] leading-[1.45] text-foreground-subtle">
            {image ? "We'll use your Google photo. You can change it any time from your profile." : "You can add a photo any time from your profile."}
          </p>
        </div>
      ) : (
      <div className="flex items-center gap-4">
        <button
          aria-label={image ? "Change photo" : "Upload a photo"}
          className="group relative shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          disabled={photoBusy}
          onClick={() => fileRef.current?.click()}
          type="button"
        >
          <Avatar name={fields.name || initial.email} size={64} src={image} />
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {photoBusy ? "…" : image ? "Change" : "Upload"}
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">Profile photo</p>
          <p className="mt-0.5 text-[12px] text-foreground-subtle">
            {isUploaded ? "Your uploaded photo. Shows next to your comments and in the team list." : image ? "From your Google account. Upload a different one any time." : "Shows next to your comments and in the team list."}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button className="dial-button min-h-7 px-2.5 text-[12px]" disabled={photoBusy} onClick={() => fileRef.current?.click()} type="button">
              {photoBusy ? "Uploading…" : image ? "Change" : "Upload photo"}
            </button>
            {isUploaded ? (
              <button className="min-h-7 rounded-control px-2.5 text-[12px] text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground" disabled={photoBusy} onClick={() => void removePhoto()} type="button">
                {providerImage ? "Use Google photo" : "Remove"}
              </button>
            ) : null}
          </div>
        </div>
        <input
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void uploadPhoto(file);
          }}
          ref={fileRef}
          tabIndex={-1}
          type="file"
        />
      </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-[12px] text-foreground-muted sm:col-span-2" htmlFor={`${id}-name`}>
          Name
          <input autoComplete="name" className={inputClass} id={`${id}-name`} maxLength={profileLimits.name} onChange={set("name")} required value={fields.name} />
        </label>
        <label className="block text-[12px] text-foreground-muted" htmlFor={`${id}-title`}>
          Title
          <input className={inputClass} id={`${id}-title`} maxLength={profileLimits.title} onChange={set("title")} placeholder="Senior product designer" value={fields.title} />
        </label>
        <label className="block text-[12px] text-foreground-muted" htmlFor={`${id}-department`}>
          Department
          <input className={inputClass} id={`${id}-department`} list={`${id}-departments`} maxLength={profileLimits.department} onChange={set("department")} placeholder="Product Design" value={fields.department} />
          <datalist id={`${id}-departments`}>
            {departmentSuggestions.map((department) => <option key={department} value={department} />)}
          </datalist>
        </label>
        {compact ? null : (
          <>
            <label className="block text-[12px] text-foreground-muted" htmlFor={`${id}-pronouns`}>
              Pronouns <span className="text-foreground-subtle">(optional)</span>
              <input className={inputClass} id={`${id}-pronouns`} maxLength={profileLimits.pronouns} onChange={set("pronouns")} placeholder="they/them" value={fields.pronouns} />
            </label>
            <label className="block text-[12px] text-foreground-muted" htmlFor={`${id}-timezone`}>
              <span className="flex items-center justify-between">
                Time zone
                <button className="text-[11px] text-foreground-subtle hover:text-foreground" onClick={() => setFields((current) => ({ ...current, timezone: detectTimezone() }))} type="button">Use this device&apos;s</button>
              </span>
              <input className={inputClass} id={`${id}-timezone`} maxLength={profileLimits.timezone} onChange={set("timezone")} placeholder="Asia/Manila" value={fields.timezone} />
            </label>
            <label className="block text-[12px] text-foreground-muted sm:col-span-2" htmlFor={`${id}-bio`}>
              <span className="flex items-center justify-between">
                About you
                <span className="font-mono text-[10px] text-foreground-subtle">{fields.bio.length}/{profileLimits.bio}</span>
              </span>
              <textarea
                className={inputClass + " h-auto min-h-20 resize-y py-2.5 leading-5"}
                id={`${id}-bio`}
                maxLength={profileLimits.bio}
                onChange={set("bio")}
                placeholder="What you work on, which projects you lead, how you like feedback."
                value={fields.bio}
              />
            </label>
          </>
        )}
      </div>

      {error ? <p className="rounded-control bg-danger/10 px-3 py-2 text-[12px] text-foreground" role="alert">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <p aria-live="polite" className="mr-auto text-[12px] text-foreground-subtle">{notice}</p>
        {secondaryAction}
        <button className="min-h-9 rounded-control bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50" disabled={saving || photoBusy || !fields.name.trim()} type="submit">
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
