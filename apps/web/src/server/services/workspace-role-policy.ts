export function isWorkspaceRoleAllowed<Role extends string>(
  role: Role,
  allowedRoles: readonly Role[],
) {
  return allowedRoles.includes(role);
}
