import { workspaceListing } from '../../../../lib/hostaway-listing-server';
export const GET = (request: Request) => workspaceListing(request);
export const POST = (request: Request) => workspaceListing(request);
