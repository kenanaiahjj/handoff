import HandoffPage from "@/app/workspace/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/page";
import { companyRoute } from "@/src/components/shell/company-route";

export const maxDuration = 300;
export const instant = false;

export default companyRoute<{ projectId: string; handoffId: string }>(HandoffPage);
