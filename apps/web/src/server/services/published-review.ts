export function versionsVisibleToReview<T extends { id: string }>(
  versions: readonly T[],
  publishedVersionId: string | null,
) {
  if (!publishedVersionId) return [];
  const publishedIndex = versions.findIndex((version) => version.id === publishedVersionId);
  return publishedIndex < 0 ? [] : versions.slice(publishedIndex);
}
