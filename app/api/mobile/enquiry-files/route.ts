import { enquiryFilesRoute } from '../../../../lib/client-enquiry-server';
export const GET = (request: Request) => enquiryFilesRoute(request, true);
