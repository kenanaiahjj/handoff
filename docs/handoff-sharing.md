# Handoff sharing and lifecycle

Publish a version to create a stable review URL for a handoff. The URL opens the canvas view and shows the published version and its earlier versions. Later drafts remain private until an owner or designer publishes them.

## Choose who can open the canvas

Each handoff has one sharing mode:

| Mode | Access |
| --- | --- |
| Workspace members | A signed-in workspace member can view and use the review tools. |
| Only invited people | Anyone with an active invitation link can view and comment without signing in. PD, QA, DEV, and EXEC links have the same tools; the role and email are comment labels, not verified identities. Invitees do not need workspace membership. |
| Anyone with the link | Signed-in workspace members retain their review tools. Other viewers can use the stable canvas URL without signing in, but cannot comment, add notes, change QA status, or manage integrations. |

Changing the mode applies to the same stable URL. The app scopes public assets and API reads to versions visible through that handoff. Review data is not cached publicly.

Owners and designers can open **Access** from the project handoff list or manage sharing from the canvas version panel. Both places use the same access controls. The project list shows whether each handoff is unpublished, workspace-only, invite-only, or open to anyone with its link. In workspace mode, the access panel lists workspace members and their roles. In invite-only mode, it lists workspace owners and designers plus active invite links, recipient labels, roles, and expiry dates. In public mode, it explains that link viewers cannot be identified. You can copy the canvas URL, revoke the public link, or revoke an invitation. Changing away from **Anyone with the link** blocks anonymous access; revoking an invitation disables only that invitation.

## Create an invitation link

1. Open the handoff's sharing settings.
2. Select **Only invited people**.
3. Enter a recipient email label, choose a role, and choose an expiry.
4. Select **Create invite**.
5. Copy the invitation link and send it to the recipient.

Invitations do not add recipients to the workspace, and the app does not send email. Each invite URL is a bearer credential: anyone who has the active URL can view and comment, so recipients can forward it. Comments use the invite's email and role as labels; the app does not verify who is using the link. Revoke an invitation to block its token. Expired and revoked invitations stop working.

## Future authentication option

Google single sign-on for company email addresses may replace or supplement link-only invites after the team agrees to the change. The current invite flow does not verify email ownership.

## Delete handoffs and versions

Only workspace owners and designers can delete handoffs, versions, or change sharing settings. Deleting a handoff removes its versions and review data and disables its review URL. Deleting a version removes its comments and notes. The app deletes an asset object only when no remaining version uses it.

If you delete the last version, the handoff remains available in the workspace with its capture form. Capture a new version to continue. If you delete the published version, its review URL becomes unavailable until you publish another version.
