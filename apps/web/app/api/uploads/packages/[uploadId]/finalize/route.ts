import { after } from "next/server";
import { notifyNewVersion } from "@/src/server/services/slack";
import { createPackageImportHandlers } from "../../package-import";

type FinalizeRoute = RouteContext<"/api/uploads/packages/[uploadId]/finalize">;
const handlers = createPackageImportHandlers();

export async function POST(request: Request, context: FinalizeRoute) {
  const { uploadId } = await context.params;
  const outcome = await handlers.finalize(request, uploadId);
  if (outcome.created) {
    after(() => notifyNewVersion(outcome.created!).catch((error) => console.warn("[slack]", error)));
  }
  return outcome.response;
}
