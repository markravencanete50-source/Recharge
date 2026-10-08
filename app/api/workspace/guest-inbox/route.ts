import { workspaceGuestInbox } from '../../../../lib/guest-inbox-server';
export const GET = (request: Request) => workspaceGuestInbox(request);
export const POST = (request: Request) => workspaceGuestInbox(request);
