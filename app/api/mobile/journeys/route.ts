import { journeyRoute } from '@/lib/journey-server';
export const GET=(request:Request)=>journeyRoute(request,true);
export const POST=(request:Request)=>journeyRoute(request,true);
