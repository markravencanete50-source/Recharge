import { workspaceEmailInbox } from '../../../../lib/email-inbox-server';
export const GET = (request: Request) => workspaceEmailInbox(request, true);
export const POST = (request: Request) => workspaceEmailInbox(request, true);
