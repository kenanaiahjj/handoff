import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresTestDatabase } from "../test-support/postgres-test-database.mjs";
import { getDatabase, setDatabasePoolForTests } from "../db.ts";
import { addProjectMember, listProjectAccess, listProjectTeam, removeProjectMember } from "./project-access.ts";

async function withDatabase(run) {
  const fixture = await createPostgresTestDatabase();
  setDatabasePoolForTests(fixture.pool);
  try {
    const db = getDatabase();
    const people = [["owner", "Olive Owner", "owner"], ["designer", "Dana Designer", "designer"], ["dev", "Devin Dev", "developer"], ["qa", "Quinn QA", "qa"], ["viewer", "Rae Reviewer", "reviewer"]];
    for (const [id, name] of people) {
      await db.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, true, now(), now())`).run(id, name, `${id}@example.invalid`);
    }
    await db.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES ('w', 'Asbir', 'owner', now())").run();
    for (const [id, , role] of people) await db.prepare("INSERT INTO workspace_membership VALUES ('w', ?, ?, now())").run(id, role);
    await db.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at, pd_in_charge_user_id) VALUES ('p', 'w', 'Tripket', 'owner', now(), 'owner')").run();
    await run(db);
  } finally {
    setDatabasePoolForTests(undefined);
    await fixture.close();
  }
}

test("the project team lists the PD in charge first, then designers, developers, QA and reviewers", async () => {
  await withDatabase(async () => {
    await addProjectMember({ workspaceId: "w", projectId: "p", email: "viewer@example.invalid", role: "exec", addedBy: "owner" });
    await addProjectMember({ workspaceId: "w", projectId: "p", email: "QA@example.invalid", role: "qa", addedBy: "owner" });
    await addProjectMember({ workspaceId: "w", projectId: "p", email: "dev@example.invalid", role: "dev", addedBy: "owner" });
    // Designers see everything already, but can still be on a team so people know who to ask.
    await addProjectMember({ workspaceId: "w", projectId: "p", email: "designer@example.invalid", role: "pd", addedBy: "owner" });

    const team = await listProjectTeam("w", "p");
    assert.deepEqual(team.map((person) => [person.name, person.role, person.isPdInCharge]), [
      ["Olive Owner", "pd", true],
      ["Dana Designer", "pd", false],
      ["Devin Dev", "dev", false],
      ["Quinn QA", "qa", false],
      ["Rae Reviewer", "exec", false],
    ]);

    const access = await listProjectAccess("w", "p");
    assert.ok(access.members.some((member) => member.email === "designer@example.invalid"));
    assert.deepEqual(access.fullAccess.map((person) => person.email), ["owner@example.invalid"]);
  });
});

test("changing a role keeps one entry, and removing someone takes them off the team", async () => {
  await withDatabase(async () => {
    await addProjectMember({ workspaceId: "w", projectId: "p", email: "dev@example.invalid", role: "exec", addedBy: "owner" });
    await addProjectMember({ workspaceId: "w", projectId: "p", email: "dev@example.invalid", role: "dev", addedBy: "owner" });
    let team = await listProjectTeam("w", "p");
    assert.deepEqual(team.filter((person) => person.email === "dev@example.invalid").map((person) => person.role), ["dev"]);

    await removeProjectMember({ workspaceId: "w", projectId: "p", email: "dev@example.invalid" });
    team = await listProjectTeam("w", "p");
    assert.equal(team.some((person) => person.email === "dev@example.invalid"), false);
  });
});
