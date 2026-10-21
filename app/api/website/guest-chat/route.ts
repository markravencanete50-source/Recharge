import { websiteGuestChatRoute } from '../../../../lib/website-guest-messages-server';
export const POST = (request: Request) => websiteGuestChatRoute(request);
