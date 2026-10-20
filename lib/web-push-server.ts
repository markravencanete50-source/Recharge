import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota, securityRpc } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure } from './business-server';
import { integrationSettings } from './integration-server';
import { dispatchWebPush, PUSH_SERVICE, sendWebPushResult, webPushKeys } from './web-push';

// The browser app's notification switch: GET gives Recharge's public key (or null while web push
// is not set up) and how this person's devices are doing; POST adds or removes this browser for the
// signed-in person, or sends it a test notification and says what the push service answered.
const device = { endpoint: z.string().url().max(1000).regex(PUSH_SERVICE), p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{20,24}$/) };
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subscribe'), ...device }).strict(),
  z.object({ action: z.literal('test'), ...device }).strict(),
  z.object({ action: z.literal('unsubscribe'), endpoint: z.string().url().max(1000) }).strict(),
]);
export async function webPushRoute(request: Request) {
  if (request.method === 'POST' && !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, false);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    const keys = webPushKeys(integrationSettings());
    if (request.method === 'GET') {
      // Read while the database is a step behind too: the switch still works, only the device list is missing.
      const devices = keys ? await session.client.rpc('workspace_web_push_status').then(r => r.error ? null : r.data, () => null) : null;
      return businessResponse({ publicKey: keys?.publicKey ?? null, devices });
    }
    if (!keys) return businessResponse({ error: 'Notifications are being set up. Try again later.' }, 503);
    const quota = await requestQuota(request, 'web-push-user', 10, 60, session.account.userId);
    if (!quota.allowed) return businessResponse({ error: 'Too many changes. Please wait a minute.' }, 429);
    const parsed = inputSchema.safeParse(await boundedJson(request));
    if (!parsed.success) return businessResponse({ error: 'Check the notification settings' }, 400);
    if (parsed.data.action === 'test') {
      // Linked to this person first, so a test only ever goes to a browser of the person asking.
      const linked = await session.client.rpc('workspace_web_push_subscribe', { input: { endpoint: parsed.data.endpoint, p256dh: parsed.data.p256dh, auth: parsed.data.auth } });
      if (linked.error) return databaseFailure(linked.error);
      const sent = await sendWebPushResult(parsed.data, keys, { title: 'Recharge', message: 'Test notification: pop-ups reach this device.' });
      return businessResponse({ data: sent });
    }
    const result = parsed.data.action === 'subscribe'
      ? await session.client.rpc('workspace_web_push_subscribe', { input: { endpoint: parsed.data.endpoint, p256dh: parsed.data.p256dh, auth: parsed.data.auth } })
      : await session.client.rpc('workspace_web_push_unsubscribe', { target_endpoint: parsed.data.endpoint });
    return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data });
  } catch { return businessResponse({ error: 'Notifications are temporarily unavailable' }, 503); }
}
// A sender's profile photo for a pop-up: a signed link to the private avatars bucket that lasts an hour (a pop-up is shown as it
// arrives; one that arrives later shows without the photo). The photo path never reaches a device.
const PHOTO_SECONDS = 3600, AVATAR_BUCKET = 'avatars'; // lib/chat-media-server.ts
function photoSigner() {
  const config = authSecurityConfiguration();
  if (!config) return undefined;
  const avatars = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(AVATAR_BUCKET);
  return async (path: string) => {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return null;
    const signed = await avatars.createSignedUrl(path, PHOTO_SECONDS);
    return signed.error ? null : signed.data?.signedUrl ?? null;
  };
}
// The first photo a message carries, the same way: an hour's link to the private chat-files bucket, only for a path the backend
// gave (a conversation's own folder and an image), never a link anyone else could keep using.
const CHAT_FILES_BUCKET = 'chat-files'; // lib/chat-media-server.ts CHAT_BUCKET
function attachmentSigner() {
  const config = authSecurityConfiguration();
  if (!config) return undefined;
  const files = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(CHAT_FILES_BUCKET);
  return async (path: string) => {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif)$/.test(path)) return null;
    const signed = await files.createSignedUrl(path, PHOTO_SECONDS);
    return signed.error ? null : signed.data?.signedUrl ?? null;
  };
}
export const runWebPush = () => dispatchWebPush(integrationSettings(), securityRpc, photoSigner(), attachmentSigner());
