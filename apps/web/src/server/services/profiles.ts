import { createHash } from "node:crypto";
import { getDatabase } from "../db";
import { profileLimits, type ProfileAbout } from "@/src/lib/profile-fields";
import { sniffImageType, type ProjectIconType } from "./project-icons";

export class ProfileError extends Error {}

/** Photos are cropped and scaled to 256 px in the browser before upload, so this is generous. */
export const avatarMaxBytes = 512 * 1024;

export type Profile = ProfileAbout & {
  id: string;
  name: string;
  email: string;
  image: string | null;
  jobRole: string | null;
  hasUploadedPhoto: boolean;
  /** The sign-in provider's picture (Google) an upload replaced, restored when the upload is removed. */
  providerImage: string | null;
};

export function avatarUrl(userId: string, version: string) {
  return `/api/users/${encodeURIComponent(userId)}/avatar?v=${version}`;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const row = (await getDatabase()
    .prepare(
      `SELECT "user".id, "user".name, "user".email, "user".image,
              user_profile.job_role AS jobRole,
              user_about.title, user_about.department, user_about.pronouns, user_about.timezone, user_about.bio,
              (user_avatar.user_id IS NOT NULL) AS hasUploadedPhoto, user_avatar.previous_image AS providerImage
       FROM "user"
       LEFT JOIN user_profile ON user_profile.user_id = "user".id
       LEFT JOIN user_about ON user_about.user_id = "user".id
       LEFT JOIN user_avatar ON user_avatar.user_id = "user".id
       WHERE "user".id = ?`,
    )
    .get(userId)) as (Omit<Profile, "hasUploadedPhoto"> & { hasUploadedPhoto: boolean | number }) | undefined;
  return row ? { ...row, hasUploadedPhoto: Boolean(row.hasUploadedPhoto) } : null;
}

function clean(value: string | null | undefined, limit: number, label: string) {
  if (value === undefined) return undefined;
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length > limit) throw new ProfileError(`${label} can be up to ${limit} characters.`);
  return trimmed || null;
}

export type ProfileUpdate = Partial<ProfileAbout> & { name?: string };

/** Saves what changed; fields left out keep their value, empty strings clear them. */
export async function updateProfile(userId: string, update: ProfileUpdate) {
  const name = clean(update.name, profileLimits.name, "Name");
  if (update.name !== undefined && !name) throw new ProfileError("Add your name.");
  const fields = {
    title: clean(update.title, profileLimits.title, "Title"),
    department: clean(update.department, profileLimits.department, "Department"),
    pronouns: clean(update.pronouns, profileLimits.pronouns, "Pronouns"),
    timezone: clean(update.timezone, profileLimits.timezone, "Time zone"),
    bio: update.bio === undefined ? undefined : ((update.bio ?? "").trim() || null),
  };
  if (fields.bio && fields.bio.length > profileLimits.bio) throw new ProfileError(`Bio can be up to ${profileLimits.bio} characters.`);
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.transaction(async () => {
    if (name) await database.prepare(`UPDATE "user" SET name = ?, "updatedAt" = now() WHERE id = ?`).run(name, userId);
    const current = (await getProfile(userId));
    const merged = {
      title: fields.title === undefined ? current?.title ?? null : fields.title,
      department: fields.department === undefined ? current?.department ?? null : fields.department,
      pronouns: fields.pronouns === undefined ? current?.pronouns ?? null : fields.pronouns,
      timezone: fields.timezone === undefined ? current?.timezone ?? null : fields.timezone,
      bio: fields.bio === undefined ? current?.bio ?? null : fields.bio,
    };
    await database
      .prepare(
        `INSERT INTO user_about (user_id, title, department, pronouns, timezone, bio, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET title = excluded.title, department = excluded.department,
           pronouns = excluded.pronouns, timezone = excluded.timezone, bio = excluded.bio, updated_at = excluded.updated_at`,
      )
      .run(userId, merged.title, merged.department, merged.pronouns, merged.timezone, merged.bio, now);
  })();
  return getProfile(userId);
}

export async function setAvatar(userId: string, bytes: Uint8Array) {
  if (!bytes.length) throw new ProfileError("Choose a photo.");
  if (bytes.length > avatarMaxBytes) throw new ProfileError("Photos can be up to 512 KB.");
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new ProfileError("Use a PNG, JPEG or WebP image.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const image = avatarUrl(userId, sha256.slice(0, 12));
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.transaction(async () => {
    // Remember the Google (or other provider) picture this replaces; a re-upload keeps the first one.
    const current = (await database.prepare(`SELECT image FROM "user" WHERE id = ?`).get(userId)) as { image: string | null } | undefined;
    const providerImage = current?.image && !current.image.startsWith("/api/users/") ? current.image : null;
    await database
      .prepare(
        `INSERT INTO user_avatar (user_id, content_type, bytes, sha256, previous_image, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes,
           sha256 = excluded.sha256, updated_at = excluded.updated_at,
           previous_image = COALESCE(user_avatar.previous_image, excluded.previous_image)`,
      )
      .run(userId, contentType, Buffer.from(bytes), sha256, providerImage, now);
    await database.prepare(`UPDATE "user" SET image = ?, "updatedAt" = now() WHERE id = ?`).run(image, userId);
  })();
  return { image };
}

/** Removes an uploaded photo and goes back to the sign-in provider's picture, if there was one. */
export async function deleteAvatar(userId: string) {
  const database = getDatabase();
  let image: string | null = null;
  await database.transaction(async () => {
    const row = (await database.prepare("SELECT previous_image AS previousImage FROM user_avatar WHERE user_id = ?").get(userId)) as { previousImage: string | null } | undefined;
    image = row?.previousImage ?? null;
    await database.prepare("DELETE FROM user_avatar WHERE user_id = ?").run(userId);
    // Only replaces our own photo URL, never a provider picture set some other way.
    await database.prepare(`UPDATE "user" SET image = ?, "updatedAt" = now() WHERE id = ? AND image LIKE '/api/users/%'`).run(image, userId);
  })();
  return { image };
}

export async function getAvatar(userId: string) {
  const row = (await getDatabase()
    .prepare("SELECT content_type AS contentType, bytes, sha256 FROM user_avatar WHERE user_id = ?")
    .get(userId)) as { contentType: ProjectIconType; bytes: Buffer; sha256: string } | undefined;
  return row ?? null;
}
