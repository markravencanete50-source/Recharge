import { propertyDetails } from "@/lib/business-private-routes";
export const GET = (request: Request) => propertyDetails(request, true);
export const POST = (request: Request) => propertyDetails(request, true);
