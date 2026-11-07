import { z } from "zod";
import { publishHandoffVersion } from "@/src/server/repositories/handoffs";
import { requireProjectMember, WorkspaceAccessError } from "@/src/server/workspace-access";

type PublishRoute = RouteContext<"/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/publish">;

const publishSchema = z.object({ versionId: z.string().uuid() });

export async function POST(request: Request, context: PublishRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Select a version to publish." }, { status: 400 });
  }

  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Select a valid version to publish." }, { status: 400 });

  try {
    const access = await requireProjectMember(request, workspaceId, projectId);
    const published = publishHandoffVersion({
      workspaceId,
      projectId,
      handoffId,
      versionId: parsed.data.versionId,
      publishedByUserId: access.userId,
    });
    if (!published) return Response.json({ error: "Handoff version not found." }, { status: 404 });

    const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
    const reviewUrl = new URL(`/review/${encodeURIComponent(published.reviewShareId)}`, origin).toString();
    return Response.json({ ...published, reviewUrl }, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.includes("Publish the latest handoff version")) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
