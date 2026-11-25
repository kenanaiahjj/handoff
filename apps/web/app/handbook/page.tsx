import HandbookPage from "@/app/workspace/[workspaceId]/handbook/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const instant = false;

export default companyRoute<{}>(HandbookPage);
