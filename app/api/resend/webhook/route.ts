import { resendWebhookRoute } from '../../../../lib/email-inbound-server';
export const POST = (request: Request) => resendWebhookRoute(request);
