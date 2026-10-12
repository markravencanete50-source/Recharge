import { workspaceOwner } from '../../../../lib/owner-server';
export const GET = (request: Request) => workspaceOwner(request);
export const POST = (request: Request) => workspaceOwner(request);
