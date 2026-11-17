import { renewCaptureSession } from "@/src/server/repositories/capture-sessions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
  "Access-Control-Max-Age": "600",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(asbir_capture_[A-Za-z0-9_-]{32,})$/)?.[1];
  if (!token) return Response.json({ error: "A valid capture token is required." }, { status: 401, headers: corsHeaders });

  const session = await renewCaptureSession(token);
  if (!session) {
    return Response.json({ error: "This capture session cannot be renewed. Start a new capture." }, { status: 401, headers: corsHeaders });
  }
  return Response.json(session, { headers: corsHeaders });
}
