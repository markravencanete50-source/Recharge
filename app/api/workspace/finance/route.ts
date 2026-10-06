import { workspaceFinance } from '../../../../lib/workspace-finance-server';
export const GET = (request: Request) => workspaceFinance(request);
export const POST = (request: Request) => workspaceFinance(request);
