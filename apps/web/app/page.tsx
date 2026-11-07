import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionForHeaders } from "@/src/server/auth-session";

export const instant = false;

export default async function HomePage() {
  const session = await getSessionForHeaders(await headers());
  redirect(session ? "/workspace" : "/sign-in");
}
