import { businessReport } from "@/lib/business-reports";
export const GET = (request: Request) => businessReport(request);
