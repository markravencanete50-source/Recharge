import { workspaceOversight } from '../../../../lib/oversight-server';
export const GET = (request: Request) => workspaceOversight(request, true);
export const POST = (request: Request) => workspaceOversight(request, true);
