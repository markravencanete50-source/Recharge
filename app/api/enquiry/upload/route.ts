import { enquiryUploadRoute } from '../../../../lib/client-enquiry-server';
export const POST = (request: Request) => enquiryUploadRoute(request);
