import assert from "node:assert/strict";
import test from "node:test";
import { inviteRoleLabel, inviteRoles, jobRoles, workspaceRoleForInvite } from "./team-roles.ts";

test("invite links offer every onboarding role, plus Owner", () => {
  assert.deepEqual(inviteRoles, [...Object.keys(jobRoles), "owner"]);
  assert.deepEqual(inviteRoles.map(inviteRoleLabel), ["Product designer", "Developer", "QA", "Project manager", "Marketing", "Executive", "Owner"]);
});

test("each invite role grants the matching access", () => {
  // An owner made the link, so a designer invite needs no further approval.
  assert.equal(workspaceRoleForInvite("designer"), "designer");
  assert.equal(workspaceRoleForInvite("dev"), "developer");
  assert.equal(workspaceRoleForInvite("qa"), "qa");
  for (const role of ["pm", "marketing", "exec"]) assert.equal(workspaceRoleForInvite(role), "reviewer");
  assert.equal(workspaceRoleForInvite("owner"), "owner");
  // Self sign-up as a designer still starts as a reviewer until approved.
  assert.equal(jobRoles.designer.workspaceRole, "reviewer");
});

test("a member shows one role: what they do, ignoring a stale onboarding pick", async () => {
  const { memberRoleLabel } = await import("./team-roles.ts");
  assert.equal(memberRoleLabel("developer", "qa"), "Developer");
  assert.equal(memberRoleLabel("reviewer", "marketing"), "Marketing");
  assert.equal(memberRoleLabel("reviewer", "designer"), "Product designer");
  assert.equal(memberRoleLabel("reviewer", null), "Reviewer");
  assert.equal(memberRoleLabel("owner", "pm"), "Owner");
});
