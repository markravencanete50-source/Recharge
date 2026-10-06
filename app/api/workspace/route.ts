import { businessRead, businessWrite } from "@/lib/business-server";
export const GET = (request: Request) => businessRead(request);
export const POST = (request: Request) => businessWrite(request);
