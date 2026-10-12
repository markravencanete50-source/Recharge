import { workspaceOwner } from '../../../../lib/owner-server';
export const GET = (request: Request) => workspaceOwner(request, true);
export const POST = (request: Request) => workspaceOwner(request, true);
