import { leadFilesRoute } from '../../../../lib/lead-files-server';
export const GET = (request: Request) => leadFilesRoute(request, true);
export const POST = (request: Request) => leadFilesRoute(request, true);
