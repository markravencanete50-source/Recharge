import { workspaceClientEmail } from '../../../../lib/client-email-server';
export const GET = (request: Request) => workspaceClientEmail(request);
export const POST = (request: Request) => workspaceClientEmail(request);
