/** Roles on a project team. Client-safe: no server imports. Stored values predate the labels ("pd" is a product designer). */
export const projectRoles = ["pd", "dev", "qa", "exec"] as const;
export type ProjectRole = (typeof projectRoles)[number];

export const projectRoleLabels: Record<ProjectRole, string> = { pd: "Designer", dev: "Developer", qa: "QA", exec: "Reviewer" };
