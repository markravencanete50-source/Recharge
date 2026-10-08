import { workspaceGuestInbox } from '../../../../lib/guest-inbox-server';
export const GET = (request: Request) => workspaceGuestInbox(request, true);
export const POST = (request: Request) => workspaceGuestInbox(request, true);
