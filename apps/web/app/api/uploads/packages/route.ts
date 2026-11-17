import { createPackageImportHandlers } from "./package-import";

const handlers = createPackageImportHandlers();

export async function POST(request: Request) {
  return handlers.createIntent(request);
}
