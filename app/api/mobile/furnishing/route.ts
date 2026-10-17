import { workspaceFurnishing } from '../../../../lib/furnishing-studio-server';
export const GET = (request: Request) => workspaceFurnishing(request, true);
export const POST = (request: Request) => workspaceFurnishing(request, true);
