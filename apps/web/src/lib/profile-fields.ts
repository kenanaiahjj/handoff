/** Profile fields people fill in for their team. Client-safe: no server imports. */
export const profileLimits = { name: 80, title: 80, department: 60, pronouns: 30, timezone: 64, bio: 280 } as const;

/** Suggestions only; people can type their own. */
export const departmentSuggestions = [
  "Product Design",
  "Engineering",
  "Quality Assurance",
  "Product",
  "Marketing",
  "Leadership",
  "Operations",
] as const;

export type ProfileAbout = {
  title: string | null;
  department: string | null;
  pronouns: string | null;
  timezone: string | null;
  bio: string | null;
};

export function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

/** "Product designer · Product Design" style subtitle from whatever is filled in. */
export function profileSubtitle(about: Partial<ProfileAbout> | null | undefined, fallback = "") {
  const parts = [about?.title, about?.department].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length ? parts.join(" · ") : fallback;
}
