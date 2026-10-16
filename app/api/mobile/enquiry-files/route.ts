import { enquiryFilesRoute, ownerEnquiryFilesRoute } from '../../../../lib/client-enquiry-server';
export const GET = (request: Request) => enquiryFilesRoute(request, true);
// An owner's photos and videos on the property they added in the app (migration 20261022300000).
export const POST = (request: Request) => ownerEnquiryFilesRoute(request, true);
