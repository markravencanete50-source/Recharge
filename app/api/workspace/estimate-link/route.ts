import { estimateLinkRoute } from '../../../../lib/estimate-link-server';
export const POST = (request: Request) => estimateLinkRoute(request);
