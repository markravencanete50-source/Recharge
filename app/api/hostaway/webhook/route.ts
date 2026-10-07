import { hostawayWebhookRoute } from '@/lib/hostaway-sync';
export const POST = (request: Request) => hostawayWebhookRoute(request);
