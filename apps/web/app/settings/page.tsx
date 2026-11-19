import SettingsPage from "@/app/workspace/[workspaceId]/settings/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{}>(SettingsPage);
