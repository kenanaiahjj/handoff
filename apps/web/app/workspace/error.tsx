"use client";

import { RouteErrorView } from "@/src/components/errors/RouteErrorView";

export default function WorkspaceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorView error={error} homeHref="/workspace" retry={retry} />;
}
