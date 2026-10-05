import { businessRead, businessWrite } from "@/lib/business-server";
export const GET = (request: Request) => businessRead(request, true);
export const POST = (request: Request) => businessWrite(request, true);
