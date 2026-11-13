# Canvas publish action

## Context

The canvas already has a Share action and a publish control in the Version panel. The Version panel also contains access settings and invitation details, so the publish control can be scrolled out of view. Its unpublished-state copy tells users to open the canvas even though they are already on it.

## Goal

Make publishing an obvious canvas action. Keep publish status and version details in the Version panel. Keep privacy, invitations, and link copying in the Share dialog.

## Interaction

- Add a labeled **Publish** action beside **Share** in the canvas top bar.
- Show **Publish** when the handoff has no published version. Show **Publish update** when the latest version is newer than the published version.
- Permit publishing only when the viewer can manage sharing and the selected version is the latest. If an older version is selected, disable the action and explain that the latest version must be selected.
- Disable the action while publishing. On success, update the published status and refresh server-rendered handoff data. On failure, show an accessible inline error in the toolbar.
- Replace the Version panel's publish button and embedded access-management form with a compact publication-status row. Preserve version history, release notes, and version capture controls.
- Keep privacy selection, invite links, and copy-link behavior in the existing Share dialog. Replace the inaccurate instruction to open the canvas with a short explanation that a published version is required to create a review link.

## Data flow and permissions

- Reuse `POST /api/workspaces/{workspaceId}/projects/{projectId}/handoffs/{handoffId}/publish` with the selected `versionId`.
- Reuse the current latest-version validation and `canManageSharing` UI gate. The server remains the authorization source.
- Refresh the current route after publishing so the Version panel and Share dialog reflect the saved publication state.
- Do not add a database migration or change link privacy, invite, or version semantics.

## Error handling and accessibility

- Keep the action disabled while the request is pending to prevent duplicate publishes.
- Surface server and network errors in a polite live region without closing the canvas or Share dialog.
- Use a visible text label, keyboard focus treatment, and disabled-state styling. Do not rely on color alone for the publication state.

## Verification

- Check an unpublished latest version: the top-bar action is visible and publishes the selected latest version.
- Check an already-published latest version: the top bar shows the published state without a redundant publish action.
- Check a newer draft and an older selected version: offer **Publish update** for the latest version and prevent publishing an older selection.
- Check publishing failures and verify that the toolbar reports the error and remains usable.
- Confirm privacy controls and invite links remain available in Share, while the Version panel no longer repeats access-management content or tells users to reopen the canvas.
