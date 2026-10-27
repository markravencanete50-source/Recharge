import { workspaceListing } from '../../../../lib/hostaway-listing-server';
export const GET = (request: Request) => workspaceListing(request, true);
export const POST = (request: Request) => workspaceListing(request, true);
