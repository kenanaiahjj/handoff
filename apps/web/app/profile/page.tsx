import ProfilePage from "@/app/workspace/[workspaceId]/profile/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{}>(ProfilePage);
