import { operationsRoute } from '../../../../lib/journey-server';
export const GET=(request:Request)=>operationsRoute(request,true);
export const POST=(request:Request)=>operationsRoute(request,true);
