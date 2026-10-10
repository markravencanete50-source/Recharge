import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin, securityHeaders } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import type { RpcContext } from './workspace-rpc-route';
import type { ChatAction } from './workspace-chat-policy';
import { profileActionSchema } from './workspace-account-policy';

// Photos and videos in Messages, and profile photos. Chat files go straight from the device to
// private storage with one-off upload links (so a 50 MB video never passes through the site);
// the database checks each stored file before a message claims it. Profile photos are small, so
// they come through here and are checked from their bytes. Everything is opened by short-lived
// signed links, for people the database says may see it.
export const CHAT_BUCKET = 'chat-files', AVATAR_BUCKET = 'avatars';
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const secretClient = () => {
  const config = authSecurityConfiguration();
  return config ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
};
const unavailable = (error = 'Photos and videos are not available just now') => businessResponse({ error }, 503);

// ---------------------------------------------------------------- Messages: uploading
// prepareFiles: the database records the files (and checks the conversation, counts and sizes),
// then each gets a one-off upload link. discardFiles: forgotten, and the stored copies deleted.
export function chatFilesAction(context: RpcContext, input: ChatAction): Promise<Response> | null {
  if (input.action !== 'prepareFiles' && input.action !== 'discardFiles') return null;
  return (async () => {
    const storage = secretClient()?.storage.from(CHAT_BUCKET);
    if (!storage) return unavailable();
    const result = await context.client.rpc('workspace_chat_action', { input });
    if (result.error) return databaseFailure(result.error);
    if (input.action === 'discardFiles') {
      const paths = z.array(z.string()).parse(result.data.paths);
      if (paths.length) await storage.remove(paths).catch(() => undefined);
      return businessResponse({ data: { discarded: paths.length }, ok: true });
    }
    const made = z.object({ files: z.array(z.object({ id: z.string().uuid(), path: z.string(), mime: z.string() })), stale: z.array(z.string()) }).parse(result.data);
    if (made.stale.length) await storage.remove(made.stale).catch(() => undefined);
    const files = [];
    for (const file of made.files) {
      const link = await storage.createSignedUploadUrl(file.path);
      if (link.error || !link.data?.signedUrl) {
        await context.client.rpc('workspace_chat_action', { input: { action: 'discardFiles', ids: made.files.map(f => f.id) } });
        return unavailable('Uploads are not available just now. Please try again in a minute.');
      }
      files.push({ ...file, uploadUrl: link.data.signedUrl });
    }
    return businessResponse({ data: { files }, ok: true });
  })();
}

// ---------------------------------------------------------------- Messages: opening
// Links (valid for an hour) for up to 60 files at once, keyed by the file's id.
const idsSchema = z.object({ ids: z.string().max(60 * 37).transform(v => v.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).min(1).max(60)) }).strict();
export async function chatFilesRoute(request: Request, native = false) {
  if (native && !isNativeRequest(request)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (request.method !== 'GET') return businessResponse({ error: 'Method not allowed' }, 405);
    const parsed = idsSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return businessResponse({ error: 'Choose files' }, 400);
    const found = await session.client.rpc('workspace_chat_files', { ids: [...new Set(parsed.data.ids)] });
    if (found.error) return databaseFailure(found.error);
    const files = z.array(z.object({ id: z.string(), path: z.string(), mime: z.string(), name: z.string(), kind: z.enum(['image', 'video']) })).parse(found.data);
    if (!files.length) return businessResponse({ data: {} });
    const storage = secretClient()?.storage.from(CHAT_BUCKET);
    if (!storage) return unavailable();
    const signed = await storage.createSignedUrls(files.map(f => f.path), 3600);
    if (signed.error || !signed.data) return unavailable();
    const urls = new Map(signed.data.filter(s => s.signedUrl && !s.error).map(s => [s.path, s.signedUrl]));
    return businessResponse({ data: Object.fromEntries(files.filter(f => urls.has(f.path)).map(f => [f.id, { url: urls.get(f.path), mime: f.mime, name: f.name, kind: f.kind }])) });
  } catch (error) { return viewAsFailure(error) ?? unavailable(); }
}

// ---------------------------------------------------------------- profiles
const imageType = (bytes: Uint8Array) => {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { mime: 'image/png', ext: 'png' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
};
const replacedSchema = z.object({ replaced: z.string().nullable().optional() }).passthrough();

// GET ?userId=…: someone's photo (a short redirect to it; the version in the address changes
// with each new photo, so it can be kept a while). POST: a new photo (form data), or saving your
// line and colour, or taking your photo off (JSON).
export async function profileRoute(request: Request, native = false) {
  if (native ? !isNativeRequest(request) : request.method === 'POST' && !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    const storage = secretClient()?.storage.from(AVATAR_BUCKET);
    if (request.method === 'GET') {
      const parsed = z.object({ userId: z.string().uuid(), v: z.string().regex(/^[0-9a-f]{1,32}$/).optional() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return businessResponse({ error: 'Choose a person' }, 400);
      const found = await session.client.rpc('workspace_profile_photo', { target: parsed.data.userId });
      if (found.error) return databaseFailure(found.error);
      if (!found.data) return businessResponse({ error: 'No photo' }, 404);
      if (!storage) return unavailable();
      const signed = await storage.createSignedUrl(String(found.data), 3600);
      if (signed.error || !signed.data?.signedUrl) return unavailable();
      return new Response(null, { status: 302, headers: { ...securityHeaders, Location: signed.data.signedUrl, 'Cache-Control': parsed.data.v ? 'private, max-age=3000' : 'private, no-store', Vary: 'Cookie, Authorization' } });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    const quota = await requestQuota(request, 'profile', 20, 600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many changes. Please wait a few minutes.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    if (request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json') {
      const input = profileActionSchema.safeParse(await boundedJson(request, 2048));
      if (!input.success) return businessResponse({ error: input.error.issues[0]?.message || 'Check your profile' }, 400);
      const result = await session.client.rpc('workspace_profile_action', { input: input.data });
      if (result.error) return databaseFailure(result.error);
      const { replaced, ...account } = replacedSchema.parse(result.data);
      if (replaced && storage) await storage.remove([replaced]).catch(() => undefined);
      return businessResponse({ data: account, ok: true });
    }
    if (!storage) return unavailable('Profile photos are not available just now');
    if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) return businessResponse({ error: 'Choose a photo' }, 400);
    const reader = request.body?.getReader(); if (!reader) return businessResponse({ error: 'Choose a photo' }, 400);
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > MAX_AVATAR_BYTES + 16384) { await reader.cancel(); return businessResponse({ error: 'Profile photos can be up to 5 MB' }, 413); }
      chunks.push(next.value);
    }
    const body = new Uint8Array(size); let offset = 0; for (const c of chunks) { body.set(c, offset); offset += c.length; }
    const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type')! } }).formData();
    const photo = form.get('photo');
    if ([...form.keys()].some(k => k !== 'photo') || form.getAll('photo').length !== 1 || !(photo instanceof Blob)) return businessResponse({ error: 'Choose a photo' }, 400);
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const type = bytes.length <= MAX_AVATAR_BYTES ? imageType(bytes) : null;
    if (!type) return businessResponse({ error: 'Choose a JPG, PNG or WebP photo up to 5 MB' }, 400);
    const path = `${session.account.userId}/${crypto.randomUUID()}.${type.ext}`;
    const stored = await storage.upload(path, bytes, { contentType: type.mime, upsert: false, cacheControl: '3600' });
    if (stored.error) return unavailable('The photo could not be saved. Please try again.');
    const result = await session.client.rpc('workspace_profile_action', { input: { action: 'setPhoto', path } });
    if (result.error) { await storage.remove([path]).catch(() => undefined); return databaseFailure(result.error); }
    const { replaced, ...account } = replacedSchema.parse(result.data);
    if (replaced) await storage.remove([replaced]).catch(() => undefined);
    return businessResponse({ data: account, ok: true });
  } catch (error) { return viewAsFailure(error) ?? unavailable('Your profile is not available just now'); }
}
