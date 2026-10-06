import { workspaceFinance } from '../../../../lib/workspace-finance-server';
export const GET = (request: Request) => workspaceFinance(request, true);
export const POST = (request: Request) => workspaceFinance(request, true);
