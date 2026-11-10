import { hashSnapshotPayload } from "./hash.ts";
import { snapshotEnvelopeSchema, snapshotPayloadSchema } from "./schema.ts";

export async function createSnapshotEnvelope(payload: unknown) {
  const normalized = snapshotPayloadSchema.safeParse(payload);
  if (!normalized.success) return normalized;

  const contentHash = await hashSnapshotPayload(normalized.data);
  return snapshotEnvelopeSchema.safeParse({ ...normalized.data, contentHash });
}
