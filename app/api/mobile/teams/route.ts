import { workspaceTeams } from '../../../../lib/workspace-finance-server';
export const GET = (request: Request) => workspaceTeams(request, true);
export const POST = (request: Request) => workspaceTeams(request, true);
