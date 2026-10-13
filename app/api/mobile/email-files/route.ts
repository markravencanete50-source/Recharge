import { emailFilesRoute } from '../../../../lib/email-inbound-server';
export const GET = (request: Request) => emailFilesRoute(request, true);
