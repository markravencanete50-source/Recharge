import { profileRoute } from '../../../../lib/chat-media-server';
export const GET = (request: Request) => profileRoute(request, true);
export const POST = (request: Request) => profileRoute(request, true);
