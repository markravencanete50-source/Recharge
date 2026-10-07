import { workspaceAdmin } from '../../../../lib/workspace-finance-server';
export const GET = (request: Request) => workspaceAdmin(request, true);
export const POST = (request: Request) => workspaceAdmin(request, true);
