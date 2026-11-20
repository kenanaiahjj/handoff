/**
 * Readable addresses for projects and handoffs: `/projects/tripket-mobile-app/handoffs/return-trips`.
 * A slug is the name in lowercase ASCII with dashes. When two siblings would share a slug, each gets
 * the first six characters of its id appended so the address stays stable and unique.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return uuidPattern.test(value);
}

export function slugify(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Slugs for siblings (all projects in a workspace, or all handoffs in a project): id → slug. */
export function assignSlugs(items: ReadonlyArray<{ id: string; name: string }>) {
  const base = new Map(items.map((item) => [item.id, slugify(item.name)]));
  const counts = new Map<string, number>();
  for (const slug of base.values()) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  const result = new Map<string, string>();
  for (const item of items) {
    const slug = base.get(item.id) ?? "";
    const suffix = item.id.replace(/-/g, "").slice(0, 6).toLowerCase();
    result.set(item.id, !slug ? suffix : (counts.get(slug) ?? 0) > 1 ? `${slug}-${suffix}` : slug);
  }
  return result;
}

/** The sibling an address segment points at: its slug, or its id from links made before slugs. */
export function findBySlug<T extends { id: string; name: string }>(items: ReadonlyArray<T>, segment: string) {
  const decoded = safeDecode(segment).toLowerCase();
  if (isUuid(decoded)) return items.find((item) => item.id.toLowerCase() === decoded) ?? null;
  const slugs = assignSlugs(items);
  return items.find((item) => slugs.get(item.id) === decoded) ?? null;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
