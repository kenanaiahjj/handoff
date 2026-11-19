import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCompanyWorkspace } from "@/src/server/services/company-workspace";

type PageComponent<P, S> = (props: {
  params: Promise<P & { workspaceId: string }>;
  searchParams: Promise<S>;
}) => ReactNode | Promise<ReactNode>;

/**
 * The app serves one company workspace, so addresses leave its id out (`/projects/…` rather than
 * `/workspace/<id>/projects/…`). This serves an existing workspace page at such an address by filling
 * in the company workspace's id on the server. The page still checks the viewer's membership itself.
 */
export function companyRoute<P extends object, S = Record<string, string | string[] | undefined>>(Page: PageComponent<P, S>) {
  return async function CompanyRoute({ params, searchParams }: { params: Promise<P>; searchParams: Promise<S> }) {
    const workspace = await getCompanyWorkspace();
    if (!workspace) redirect("/workspace");
    const withWorkspace = params.then((value) => ({ ...value, workspaceId: workspace.id }));
    return <Page params={withWorkspace} searchParams={searchParams} />;
  };
}
