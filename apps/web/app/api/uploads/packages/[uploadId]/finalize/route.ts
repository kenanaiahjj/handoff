import { after } from "next/server";
import { notifyNewVersion } from "@/src/server/services/slack";
import { emailNewVersion } from "@/src/server/services/email";
import { createPackageImportHandlers } from "../../package-import";

/**
 * Large captures (250 MB of JSON) take tens of seconds to verify, merge and store. 300 s is the
 * highest limit every Vercel plan accepts; on Pro it can be raised to 800 here.
 */
export const maxDuration = 300;

type FinalizeRoute = RouteContext<"/api/uploads/packages/[uploadId]/finalize">;
const handlers = createPackageImportHandlers();

export async function POST(request: Request, context: FinalizeRoute) {
  const { uploadId } = await context.params;
  const outcome = await handlers.finalize(request, uploadId);
  if (outcome.created) {
    after(() => notifyNewVersion(outcome.created!).catch((error) => console.warn("[slack]", error)));
    after(() => emailNewVersion(outcome.created!).catch((error) => console.warn("[email]", error)));
  }
  return outcome.response;
}
