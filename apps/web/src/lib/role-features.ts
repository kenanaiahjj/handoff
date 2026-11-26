/**
 * Canvas features an owner can turn on or off for each workspace role (Settings → Features by role).
 * Owners and product designers always get everything. Search, navigation and comments are never
 * switched off. Client-safe: no server imports.
 */
export const roleFeatureKeys = ["elementInspection", "copyImage", "assetExport", "versionCompare"] as const;
export type RoleFeature = (typeof roleFeatureKeys)[number];

export const roleFeatureDetails: Record<RoleFeature, { label: string; description: string }> = {
  elementInspection: {
    label: "Element inspection",
    description: "Clicking selects single layers, with measurements, CSS and properties. When it's off, a click selects the whole screen.",
  },
  copyImage: {
    label: "Copy as image",
    description: "⌘C / Ctrl+C copies the selected screen or element to the clipboard as a picture.",
  },
  assetExport: {
    label: "Export assets",
    description: "Download screens, icons and images as PNG, SVG or PDF.",
  },
  versionCompare: {
    label: "Compare versions",
    description: "Open two versions side by side or as a pixel diff.",
  },
};

/** Roles an owner can configure. Owners and product designers are not limited. */
export const configurableRoles = ["reviewer", "developer", "qa"] as const;
export type ConfigurableRole = (typeof configurableRoles)[number];

export const configurableRoleLabels: Record<ConfigurableRole, string> = { reviewer: "Reviewer", developer: "Developer", qa: "QA" };

export type RoleFeatureSettings = Record<ConfigurableRole, Record<RoleFeature, boolean>>;
export type RoleFeatureFlags = Record<RoleFeature, boolean>;

export const allFeaturesOn: RoleFeatureFlags = { elementInspection: true, copyImage: true, assetExport: true, versionCompare: true };

/** Until an owner changes anything: QA gives visual feedback, so clicks pick whole screens. */
export const defaultRoleFeatureSettings: RoleFeatureSettings = {
  reviewer: { ...allFeaturesOn },
  developer: { ...allFeaturesOn },
  qa: { ...allFeaturesOn, elementInspection: false },
};

function isConfigurableRole(value: string): value is ConfigurableRole {
  return (configurableRoles as readonly string[]).includes(value);
}

/** Reads what's stored, filling anything missing (a new feature, a bad value) from the defaults. */
export function normalizeRoleFeatureSettings(input: unknown): RoleFeatureSettings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const result = {} as RoleFeatureSettings;
  for (const role of configurableRoles) {
    const stored = source[role] && typeof source[role] === "object" ? (source[role] as Record<string, unknown>) : {};
    result[role] = { ...defaultRoleFeatureSettings[role] };
    for (const feature of roleFeatureKeys) {
      if (typeof stored[feature] === "boolean") result[role][feature] = stored[feature] as boolean;
    }
  }
  return result;
}

/** What someone with this workspace role gets. Unknown roles and guests without a role get everything. */
export function featuresForRole(settings: RoleFeatureSettings, role: string | null | undefined): RoleFeatureFlags {
  if (!role || !isConfigurableRole(role)) return { ...allFeaturesOn };
  return { ...settings[role] };
}
