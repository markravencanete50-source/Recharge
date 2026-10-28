import { launchFilesRoute } from '../../../../lib/launch-preparation-server';
export const GET = (request: Request) => launchFilesRoute(request, true);
export const POST = (request: Request) => launchFilesRoute(request, true);
