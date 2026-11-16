import assert from "node:assert/strict";
import test from "node:test";
import {
  hashHandoffInviteToken,
  normalizeInviteEmail,
  resolveHandoffReviewAccess,
} from "./handoff-sharing.ts";

const now = "2026-11-09T12:00:00.000Z";

test("normalizes invite email and hashes tokens before storage", () => {
  assert.equal(normalizeInviteEmail("  QA.Person@Example.com "), "qa.person@example.com");
  assert.match(hashHandoffInviteToken("private-token"), /^[a-f0-9]{64}$/);
  assert.notEqual(hashHandoffInviteToken("private-token"), "private-token");
});

test("workspace mode requires a workspace member", () => {
  assert.deepEqual(resolveHandoffReviewAccess({ mode: "workspace", isWorkspaceMember: false, now }), {
    allowed: false,
    canWrite: false,
    canComment: false,
    reason: "workspace-membership-required",
  });
  assert.deepEqual(resolveHandoffReviewAccess({ mode: "workspace", isWorkspaceMember: true, now }), {
    allowed: true,
    canWrite: true,
    canComment: true,
    reason: "workspace-member",
  });
});

test("anyone mode allows an anonymous read-only review", () => {
  assert.deepEqual(resolveHandoffReviewAccess({ mode: "anyone", isWorkspaceMember: false, now }), {
    allowed: true,
    canWrite: false,
    canComment: false,
    reason: "public-link",
  });
});

test("workspace members retain review tools when a public link is enabled", () => {
  assert.deepEqual(resolveHandoffReviewAccess({ mode: "anyone", isWorkspaceMember: true, now }), {
    allowed: true,
    canWrite: true,
    canComment: true,
    reason: "workspace-member",
  });
});

test("active invite links grant identical view and comment access for every role and sign-in state", () => {
  for (const role of ["pd", "qa", "dev", "exec"]) {
    for (const isAuthenticated of [false, true]) {
      const invite = {
        id: `invite-${role}`,
        email: `${role}.person@example.com`,
        role,
        tokenHash: hashHandoffInviteToken("invite-token"),
        expiresAt: "2026-11-10T12:00:00.000Z",
        revokedAt: null,
      };
      assert.deepEqual(resolveHandoffReviewAccess({
        mode: "invited",
        isWorkspaceMember: false,
        isAuthenticated,
        invite,
        inviteToken: "invite-token",
        now,
      }), { allowed: true, canWrite: false, canComment: true, reason: "invite-link" }, `${role} invite with isAuthenticated=${isAuthenticated}`);
    }
  }
});

test("invited mode rejects a missing link, a wrong token, revoked invites, and expired invites", () => {
  const invite = {
    email: "qa.person@example.com",
    tokenHash: hashHandoffInviteToken("invite-token"),
    expiresAt: "2026-11-10T12:00:00.000Z",
    revokedAt: null,
  };
  const base = { mode: "invited", isWorkspaceMember: false, invite, inviteToken: "invite-token", now };
  for (const overrides of [
    { inviteToken: null },
    { inviteToken: "wrong-token" },
    { invite: { ...invite, revokedAt: now } },
    { invite: { ...invite, expiresAt: "2026-11-09T11:59:59.000Z" } },
  ]) {
    const access = resolveHandoffReviewAccess({ ...base, ...overrides });
    assert.equal(access.allowed, false);
    assert.equal(access.canWrite, false);
    assert.equal(access.canComment, false);
  }
});

test("a workspace owner or designer retains management access in invited mode", () => {
  assert.deepEqual(resolveHandoffReviewAccess({
    mode: "invited",
    isWorkspaceMember: true,
    isManager: true,
    now,
  }), { allowed: true, canWrite: true, canComment: true, reason: "handoff-manager" });
});
