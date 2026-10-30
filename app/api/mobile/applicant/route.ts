import { applicantRoute } from '../../../../lib/careers-server';
export const GET = (request: Request) => applicantRoute(request, true);
export const POST = (request: Request) => applicantRoute(request, true);
