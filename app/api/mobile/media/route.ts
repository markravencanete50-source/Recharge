import { mediaRoute } from '@/lib/media-server';
export const GET=(request:Request)=>mediaRoute(request,true);
export const POST=(request:Request)=>mediaRoute(request,true);
