import ActivityPage from "@/app/workspace/[workspaceId]/activity/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{}>(ActivityPage);
