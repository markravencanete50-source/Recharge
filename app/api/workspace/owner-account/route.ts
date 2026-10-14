import { ownerAccountRoute } from '../../../../lib/owner-account-server';
export const POST = (request: Request) => ownerAccountRoute(request);
