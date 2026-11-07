ALTER TABLE project
  ADD COLUMN pd_in_charge_user_id TEXT REFERENCES "user" (id) ON DELETE SET NULL;

UPDATE project
SET pd_in_charge_user_id = created_by_user_id
WHERE EXISTS (
  SELECT 1
  FROM workspace_membership
  WHERE workspace_membership.workspace_id = project.workspace_id
    AND workspace_membership.user_id = project.created_by_user_id
    AND workspace_membership.role = 'designer'
);
