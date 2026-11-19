import ProjectPage from "@/app/workspace/[workspaceId]/projects/[projectId]/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{ projectId: string }>(ProjectPage);
