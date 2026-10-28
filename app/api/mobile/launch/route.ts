import { workspaceLaunch } from '../../../../lib/launch-preparation-server';
export const GET = (request: Request) => workspaceLaunch(request, true);
export const POST = (request: Request) => workspaceLaunch(request, true);
