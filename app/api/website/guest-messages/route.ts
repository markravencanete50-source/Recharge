import { websiteGuestMessageRoute } from '../../../../lib/website-guest-messages-server';
export const POST = (request: Request) => websiteGuestMessageRoute(request);
