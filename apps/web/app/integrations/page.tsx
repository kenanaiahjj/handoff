import IntegrationsPage from "@/app/workspace/[workspaceId]/integrations/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{}>(IntegrationsPage);
