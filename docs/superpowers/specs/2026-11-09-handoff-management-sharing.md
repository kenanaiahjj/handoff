# Handoff management and sharing

## Goal

Let workspace owners and designers remove handoffs or versions, open handoffs in separate tabs, and control who can open each published canvas.

## Access modes

Each handoff has one access mode:

- `workspace`: a signed-in workspace member can open the published canvas. This is the default and preserves current behavior.
- `invited`: the recipient signs in with the work email added by an owner or designer and uses that recipient's unique invitation link. Invited recipients are not added to the workspace. Invitation links are copied and shared manually; they remain reusable until revoked or expired.
- `anyone`: anyone with the stable published canvas URL can open it without signing in. This mode is read-only.

All modes expose only the published version and its earlier versions. New versions remain private until published. Changing the access mode applies to the existing stable review URL. Revoking an invitation only invalidates that recipient's link.

## Handoff and version lifecycle

- Workspace owners and designers can delete handoffs and versions. Enforce these roles in the server routes and hide the controls from other roles.
- Keep the current relaxed role behavior for unrelated capture and review flows.
- Confirm destructive actions. Deleting a handoff revokes its review URL and cascades its comments, findings, changelog drafts, task references, invites, and versions.
- Deleting a version removes its associated review data. If it is the published version, the review URL becomes unavailable until a remaining version is published. Keep the handoff when its last version is deleted and show a capture-again state.
- Delete stored asset objects only after no version references them. Reused assets must remain available to surviving versions.

## Navigation and controls

- Project handoff rows open the authenticated handoff page in a new tab and expose a copyable internal link.
- Project handoff rows expose an owner/designer **Access** action. It opens a dialog that shows the published canvas URL, current access mode, workspace members and roles when workspace sharing is enabled, active invitees and expiry dates when invite-only sharing is enabled, and actions to copy or revoke access. Public link viewers cannot be identified. The same access controls remain available in the canvas version panel.
- The published review URL remains a separate canvas-only link for recipients.
- The handoff's version panel shows its access mode, published URL, invite list, invite creation, and invite revocation. Only owners and designers can change sharing settings.
- `anyone` mode permits reading the canvas, comparing visible versions, viewing comments, changelog, and QA findings. It does not permit comments, annotations, QA updates, task creation, or integration management.
- `invited` and `workspace` recipients can use the existing signed-in review tools. Per-handoff invitations grant access to that handoff only.

## Security boundaries

- Add a strict role-checking helper for delete and sharing mutations. Do not change the existing relaxed role helper globally.
- Scope anonymous reads to a valid published review URL and to assets and versions visible through that URL.
- Scope invited reads and writes to an active invite token and a session whose email matches the invite's normalized email.
- Treat invite URLs as bearer credentials. The app does not currently send email or verify email ownership, so the owner must deliver each copied invite link to its intended recipient. Anyone who obtains an active invite link can use it after signing in with the listed email.
- Keep public review requests uncached and do not place share tokens in referrers.

## Acceptance checks

- An owner and a designer can delete a handoff or any version; a reviewer, developer, or QA user receives a forbidden response from the same mutation routes.
- Deleting a non-last version preserves the handoff and every asset still referenced by another version.
- Deleting the last version leaves an openable handoff page with the capture form and no canvas selection.
- Deleting a published version disables the published review URL. Deleting a handoff disables the review URL and cascades related rows.
- A project handoff link has `target="_blank"`, a safe `rel` value, and a copy-link action.
- `workspace` mode requires membership, `invited` mode requires a matching active invite and signed-in email, and `anyone` mode loads without a session.
- Anonymous requests cannot access an unpublished version, another handoff's asset, or a write endpoint.
- Revoking or expiring an invite blocks that invite token without changing other recipients' access.
- Switching away from `anyone` immediately blocks the old public link while preserving the stable URL for future publication.
