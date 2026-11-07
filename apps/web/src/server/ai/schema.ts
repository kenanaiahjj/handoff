import { z } from "zod";

export const audienceSchema = z.enum(["product", "developer", "qa"]);

export const generatedStatementSchema = z.object({
  audience: audienceSchema,
  text: z.string().trim().min(1).max(2000),
  evidence: z.array(z.string().min(1)).min(1).max(12),
});

export const generatedChangelogSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2000),
  statements: z.array(generatedStatementSchema).min(1).max(60),
});

export const evidenceRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["frame", "diff", "finding", "comment"]),
  label: z.string().min(1),
  details: z.string().min(1),
  versionId: z.string().min(1),
  frameId: z.string().min(1),
  sourceNodeId: z.string().nullable(),
  path: z.string().nullable(),
});

export type GeneratedChangelog = z.infer<typeof generatedChangelogSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
