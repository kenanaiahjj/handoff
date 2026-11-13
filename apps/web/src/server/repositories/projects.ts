import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { projectRulesSchema } from "../services/layout-rules";

export function createProject(input: {
  workspaceId: string;
  createdBy: string;
  name: string;
}) {
  const database = getDatabase();
  const creator = database
    .prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
    .get(input.workspaceId, input.createdBy) as { role: string } | undefined;
  const project = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    pdInChargeUserId: creator?.role === "owner" || creator?.role === "designer" ? input.createdBy : null,
  };

  database
    .prepare(
      `INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at, pd_in_charge_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(project.id, project.workspaceId, project.name, project.createdBy, project.createdAt, project.pdInChargeUserId);

  return project;
}

export function listProjects(workspaceId: string) {
  return getDatabase()
    .prepare(
      `SELECT project.id, project.name, project.created_at AS createdAt,
              COUNT(DISTINCT handoff.id) AS handoffCount,
              COUNT(handoff_version.id) AS versionCount
       FROM project
       LEFT JOIN handoff ON handoff.project_id = project.id
       LEFT JOIN handoff_version ON handoff_version.handoff_id = handoff.id
       WHERE project.workspace_id = ?
       GROUP BY project.id
       ORDER BY project.created_at DESC`,
    )
    .all(workspaceId);
}

export function listProjectsPage(workspaceId: string, input: { offset: number; limit: number }) {
  const database = getDatabase();
  const total = (database
    .prepare("SELECT COUNT(*) AS total FROM project WHERE workspace_id = ?")
    .get(workspaceId) as { total: number }).total;
  const items = database
    .prepare(
      `SELECT project.id, project.name, project.created_at AS createdAt,
              COUNT(DISTINCT handoff.id) AS handoffCount,
              COUNT(handoff_version.id) AS versionCount
       FROM project
       LEFT JOIN handoff ON handoff.project_id = project.id
       LEFT JOIN handoff_version ON handoff_version.handoff_id = handoff.id
       WHERE project.workspace_id = ?
       GROUP BY project.id
       ORDER BY project.created_at DESC, project.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(workspaceId, input.limit, input.offset);

  return { items, total };
}

export function getProject(input: { workspaceId: string; projectId: string }) {
  const project = getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, name, rules_json AS rulesJson,
              pd_in_charge_user_id AS pdInChargeUserId,
              created_at AS createdAt
       FROM project WHERE id = ? AND workspace_id = ?`,
    )
    .get(input.projectId, input.workspaceId) as
    | { id: string; workspaceId: string; name: string; rulesJson: string; pdInChargeUserId: string | null; createdAt: string }
    | undefined;
  if (!project) return undefined;
  return {
    ...project,
    rules: projectRulesSchema.parse(JSON.parse(project.rulesJson)),
  };
}

export function setProjectRules(input: { workspaceId: string; projectId: string; rulesJson: string }) {
  const result = getDatabase()
    .prepare("UPDATE project SET rules_json = ? WHERE id = ? AND workspace_id = ?")
    .run(input.rulesJson, input.projectId, input.workspaceId);
  return result.changes === 1;
}

export function listProjectPdCandidates(workspaceId: string) {
  return getDatabase()
    .prepare(
      `SELECT workspace_membership.user_id AS id, "user".name, "user".email, workspace_membership.role
       FROM workspace_membership
       JOIN "user" ON "user".id = workspace_membership.user_id
       WHERE workspace_membership.workspace_id = ?
         AND workspace_membership.role IN ('owner', 'designer')
       ORDER BY "user".name COLLATE NOCASE, "user".email COLLATE NOCASE`,
    )
    .all(workspaceId) as Array<{ id: string; name: string; email: string; role: "owner" | "designer" }>;
}

export function listWorkspaceMembers(workspaceId: string) {
  return getDatabase()
    .prepare(
      `SELECT workspace_membership.user_id AS id, "user".name, "user".email, workspace_membership.role
       FROM workspace_membership
       JOIN "user" ON "user".id = workspace_membership.user_id
       WHERE workspace_membership.workspace_id = ?
       ORDER BY "user".name COLLATE NOCASE, "user".email COLLATE NOCASE`,
    )
    .all(workspaceId) as Array<{
      id: string;
      name: string;
      email: string;
      role: "owner" | "designer" | "reviewer" | "developer" | "qa";
    }>;
}

export function assignProjectPdInCharge(input: { workspaceId: string; projectId: string; pdInChargeUserId: string | null }) {
  const result = getDatabase()
    .prepare(
      `UPDATE project
       SET pd_in_charge_user_id = ?
       WHERE id = ? AND workspace_id = ?
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM workspace_membership
           WHERE workspace_id = project.workspace_id AND user_id = ? AND role IN ('owner', 'designer')
         ))`,
    )
    .run(input.pdInChargeUserId, input.projectId, input.workspaceId, input.pdInChargeUserId, input.pdInChargeUserId);
  return result.changes === 1;
}
