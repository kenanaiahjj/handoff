import { protectedResourceMetadata } from "@/src/server/mcp/well-known";

export function GET() {
  return protectedResourceMetadata();
}
