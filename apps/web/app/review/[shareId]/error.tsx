"use client";

import { RouteErrorView } from "@/src/components/errors/RouteErrorView";

export default function ReviewError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorView error={error} retry={retry} title="This handoff didn’t load" />;
}
