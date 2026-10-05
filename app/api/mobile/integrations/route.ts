import { integrationRoute } from '@/lib/integration-server';
export const GET=(request:Request)=>integrationRoute(request,true);
export const POST=(request:Request)=>integrationRoute(request,true);
