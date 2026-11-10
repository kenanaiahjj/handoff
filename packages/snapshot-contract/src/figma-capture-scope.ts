const scopeLabels = new Map<string, string>([
  ["selected", "Selected frames and components"],
  ["selected frames and components", "Selected frames and components"],
  ["page", "All top-level frames and components on the current page"],
  ["all top-level frames and components on current page", "All top-level frames and components on the current page"],
  ["file", "All top-level frames and components across all pages"],
  ["all top-level frames and components across all pages", "All top-level frames and components across all pages"],
]);

export function formatFigmaCaptureScope(scope: unknown): string | null {
  if (typeof scope !== "string") return null;
  const normalized = scope.trim();
  if (!normalized) return null;
  return scopeLabels.get(normalized.toLowerCase()) ?? normalized;
}
