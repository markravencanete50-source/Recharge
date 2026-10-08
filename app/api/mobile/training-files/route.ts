import { trainingFilesRoute } from '../../../../lib/training-files-server';
export const GET = (request: Request) => trainingFilesRoute(request, true);
export const POST = (request: Request) => trainingFilesRoute(request, true);
