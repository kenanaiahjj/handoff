import TeamPage from "@/app/workspace/[workspaceId]/team/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{}>(TeamPage);
