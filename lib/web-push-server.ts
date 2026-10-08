import { z } from 'zod';
import { authSecurityConfiguration, requestQuota, securityRpc } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure } from './business-server';
import { integrationSettings } from './integration-server';
import { dispatchWebPush, webPushKeys } from './web-push';

// The browser app's notification switch: GET gives Recharge's public key (or null while web push
// is not set up); POST adds or removes this browser for the signed-in person.
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subscribe'), endpoint: z.string().url().max(1000).startsWith('https://'), p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{20,24}$/) }).strict(),
  z.object({ action: z.literal('unsubscribe'), endpoint: z.string().url().max(1000) }).strict(),
]);
export async function webPushRoute(request: Request) {
  if (request.method === 'POST' && !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, false);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    const keys = webPushKeys(integrationSettings());
    if (request.method === 'GET') return businessResponse({ publicKey: keys?.publicKey ?? null });
    if (!keys) return businessResponse({ error: 'Notifications are being set up. Try again later.' }, 503);
    const quota = await requestQuota(request, 'web-push-user', 10, 60, session.account.userId);
    if (!quota.allowed) return businessResponse({ error: 'Too many changes. Please wait a minute.' }, 429);
    const parsed = inputSchema.safeParse(await boundedJson(request));
    if (!parsed.success) return businessResponse({ error: 'Check the notification settings' }, 400);
    const result = parsed.data.action === 'subscribe'
      ? await session.client.rpc('workspace_web_push_subscribe', { input: { endpoint: parsed.data.endpoint, p256dh: parsed.data.p256dh, auth: parsed.data.auth } })
      : await session.client.rpc('workspace_web_push_unsubscribe', { target_endpoint: parsed.data.endpoint });
    return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data });
  } catch { return businessResponse({ error: 'Notifications are temporarily unavailable' }, 503); }
}
export const runWebPush = () => dispatchWebPush(integrationSettings(), securityRpc);
