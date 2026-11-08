import type { StoredChangelogDraft } from "../repositories/changelogs";

export function toMcpApprovedChangelog(changelog: StoredChangelogDraft) {
  return {
    id: changelog.id,
    status: "approved" as const,
    fromVersionId: changelog.fromVersionId,
    toVersionId: changelog.toVersionId,
    title: changelog.title,
    summary: changelog.summary,
    statements: changelog.statements,
    evidence: changelog.evidence,
    createdAt: changelog.createdAt,
    updatedAt: changelog.updatedAt,
  };
}
