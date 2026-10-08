import { workspaceOwner } from '../../../../lib/owner-server';
export const GET = (request: Request) => workspaceOwner(request);
