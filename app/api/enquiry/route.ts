import { enquiryPreflightRoute, enquirySubmitRoute } from '../../../lib/client-enquiry-server';
export const POST = (request: Request) => enquirySubmitRoute(request);
export const OPTIONS = (request: Request) => enquiryPreflightRoute(request);
