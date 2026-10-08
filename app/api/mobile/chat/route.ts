import { workspaceChat } from '../../../../lib/workspace-chat-server';
export const GET = (request: Request) => workspaceChat(request, true);
export const POST = (request: Request) => workspaceChat(request, true);
