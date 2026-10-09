import { workspaceChecklists } from '../../../../lib/clean-checklist-server';
export const GET = (request: Request) => workspaceChecklists(request, true);
export const POST = (request: Request) => workspaceChecklists(request, true);
