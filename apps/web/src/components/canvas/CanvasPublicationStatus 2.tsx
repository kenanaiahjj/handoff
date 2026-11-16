"use client";

export function CanvasPublicationStatus({
  versionId,
  latestVersionId,
  publishedVersionId,
  canPublish,
}: {
  versionId: string;
  latestVersionId: string;
  publishedVersionId: string | null;
  canPublish: boolean;
}) {
  const isLatestVersion = versionId === latestVersionId;
  const isPublished = versionId === publishedVersionId;
  const label = isPublished
    ? "Published"
    : isLatestVersion && publishedVersionId
      ? "Update not published"
      : "Not published";
  const helper = !canPublish || isPublished
    ? null
    : isLatestVersion
      ? publishedVersionId ? "Use Publish update in the toolbar to refresh the review link." : "Use Publish in the toolbar to create a review link."
      : "Select the latest version to publish.";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={"size-1.5 rounded-full " + (isPublished ? "bg-success" : "bg-foreground-subtle")} />
        <span className="text-[10px] text-foreground-subtle">Publication</span>
        <span className="text-[11px] font-medium text-foreground">{label}</span>
      </div>
      {helper ? <p className="text-[10px] leading-4 text-foreground-muted">{helper}</p> : null}
    </div>
  );
}
