import { finalizeChangelogDraft } from "@/src/server/ai/draft-changelog";
import { streamChangelog } from "@/src/server/ai/openai-provider";
import { createChangelogDraft } from "@/src/server/repositories/changelogs";
import { changelogErrorResponse, resolveChangelogRequest } from "@/src/server/services/changelog-request";

type ChangelogStreamRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string }>;
};

/**
 * Streams the draft as JSON text for the panel's `useObject` hook, then validates its
 * evidence citations and saves it before closing the stream. A failed check errors the
 * stream, so the client never treats an unsaved draft as finished.
 */
export async function POST(request: Request, context: ChangelogStreamRoute) {
  try {
    const resolved = await resolveChangelogRequest(request, await context.params);
    if (!resolved.ok) return resolved.response;

    const generation = streamChangelog(resolved.prepared.generationInput);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of generation.textStream) controller.enqueue(encoder.encode(chunk));
          const content = await generation.output();
          const draft = finalizeChangelogDraft(resolved.prepared, { content, model: generation.model });
          (await createChangelogDraft({
            workspaceId: resolved.workspaceId,
            handoffId: resolved.handoffId,
            fromVersionId: resolved.fromVersionId,
            toVersionId: resolved.toVersionId,
            ...draft,
            createdBy: resolved.actorId,
          }));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return changelogErrorResponse(error);
  }
}
