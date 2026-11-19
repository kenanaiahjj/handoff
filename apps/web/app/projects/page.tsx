import ProjectsPage from "@/app/workspace/[workspaceId]/projects/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{}>(ProjectsPage);
