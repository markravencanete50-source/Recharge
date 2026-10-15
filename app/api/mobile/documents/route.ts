import { workspaceDocuments } from '../../../../lib/invoice-maker-server';
export const GET = (request: Request) => workspaceDocuments(request, true);
export const POST = (request: Request) => workspaceDocuments(request, true);
