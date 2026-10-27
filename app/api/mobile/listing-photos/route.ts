import { listingPhotosRoute } from '../../../../lib/hostaway-listing-server';
export const GET = (request: Request) => listingPhotosRoute(request, true);
export const POST = (request: Request) => listingPhotosRoute(request, true);
