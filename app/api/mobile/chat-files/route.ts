import { chatFilesRoute } from '../../../../lib/chat-media-server';
export const GET = (request: Request) => chatFilesRoute(request, true);
