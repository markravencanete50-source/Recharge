import { workspaceControls } from '../../../../lib/workspace-controls-server';
export const GET = (request: Request) => workspaceControls(request, true);
export const POST = (request: Request) => workspaceControls(request, true);
