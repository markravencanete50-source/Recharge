import { portfolioRoute } from '../../../../lib/portfolio-server';
export const GET=(request:Request)=>portfolioRoute(request,true);
export const POST=(request:Request)=>portfolioRoute(request,true);
