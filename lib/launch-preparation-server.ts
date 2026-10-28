import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { boundedFormData } from './bounded-form';
import { trainingFileType } from './training-files';
import { LEAD_FILES_BUCKET } from './enquiry-storage-cleanup';
import { rpcRoute } from './workspace-rpc-route';
import { LAUNCH_FILE_BYTES, LAUNCH_FILE_MIMES, launchActionSchema, launchQuerySchema } from './launch-preparation';

// Launch Preparation: the settings, a property's checklist, and a housekeeper's readiness inspections. Authority lives in
// the database (migrations 20261029100000 and 20261029200000).
export const workspaceLaunch = rpcRoute({
  readSchema: launchQuerySchema, actionSchema: launchActionSchema, bodyLimit: 80_000, unavailable: 'Launch Preparation is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_launch_read', { target: input.propertyId ?? null }),
  action: 'workspace_launch_action',
});

const id = z.string().uuid();
const bucket = () => {
  const config = authSecurityConfiguration();
  if (!config) return null;
  return createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(LEAD_FILES_BUCKET);
};
const EXTENSION: Record<(typeof LAUNCH_FILE_MIMES)[number], string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Safety certificates and furnishing photos (private "lead-files" bucket, under launch/): stored here, recorded by the
// database, which decides who may add one (the team, the owner for their own documents, the installer for the furnishing).
// GET signs a ten-minute link.
export async function launchFilesRoute(request: Request, native = false) {
  if (request.method === 'POST' && (native ? !isNativeRequest(request) : !isSameOrigin(request, authSecurityConfiguration()?.origin))) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    const storage = bucket();
    if (!storage) return businessResponse({ error: 'Certificates are awaiting configuration' }, 503);
    if (request.method === 'GET') {
      const parsed = z.object({ propertyId: id, fileId: id }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return businessResponse({ error: 'Choose a certificate' }, 400);
      const file = await session.client.rpc('workspace_launch_file', { prop: parsed.data.propertyId, file: parsed.data.fileId });
      if (file.error) return databaseFailure(file.error);
      const signed = await storage.createSignedUrl(String(file.data.path), 600);
      if (signed.error || !signed.data?.signedUrl) return businessResponse({ error: 'The certificate could not be opened just now' }, 503);
      return businessResponse({ data: { url: signed.data.signedUrl, name: file.data.name, mime: file.data.mime } });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    const quota = await requestQuota(request, 'launch-files-user', 60, 600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many uploads. Please wait.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    const form = await boundedFormData(request, LAUNCH_FILE_BYTES + 65536);
    if (form === 'too-large') return businessResponse({ error: 'Certificates can be up to 15 MB each' }, 413);
    if (!form) return businessResponse({ error: 'Choose a certificate to upload' }, 400);
    if ([...form.keys()].some(k => !['propertyId', 'step', 'lineId', 'file'].includes(k)) || [...form.keys()].some(k => form.getAll(k).length !== 1)) return businessResponse({ error: 'Unexpected upload fields' }, 400);
    const propertyId = id.safeParse(form.get('propertyId')); const step = z.string().regex(/^(compliance:[a-z0-9-]{1,40}|setUp\.(received|install)|guidebook:[a-z][a-z0-9_]{1,39})$/).safeParse(form.get('step')); const file = form.get('file');
    const lineId = form.has('lineId') ? id.safeParse(form.get('lineId')) : null;
    if (lineId && !lineId.success) return businessResponse({ error: 'Choose the item' }, 400);
    if (!propertyId.success || !step.success || !(file instanceof Blob)) return businessResponse({ error: 'Choose a document and a certificate' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = (file instanceof File ? file.name : 'Certificate').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Certificate';
    const type = trainingFileType(bytes, name);
    const mime = LAUNCH_FILE_MIMES.find(m => m === type?.mime);
    if (!mime || bytes.length > LAUNCH_FILE_BYTES) return businessResponse({ error: 'Upload a PDF or a JPG, PNG or WebP photo up to 15 MB' }, 400);
    const fileId = crypto.randomUUID(), path = `launch/${propertyId.data}/${fileId}.${EXTENSION[mime]}`;
    const stored = await storage.upload(path, bytes, { contentType: mime, upsert: false, cacheControl: 'private, max-age=0' });
    if (stored.error) return businessResponse({ error: 'The certificate could not be stored. Please try again.' }, 503);
    const saved = await session.client.rpc('workspace_launch_action', { input: { action: 'addFile', requestId: crypto.randomUUID(), propertyId: propertyId.data, step: step.data, ...(lineId?.success ? { lineId: lineId.data } : {}), fileId, name, mime, bytes: bytes.length, path } });
    if (saved.error) { await storage.remove([path]).catch(() => undefined); return databaseFailure(saved.error); }
    return businessResponse({ ok: true, data: saved.data });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Certificates are temporarily unavailable' }, 503); }
}

// ---------------------------------------------------------------- the guest guidebook: no account, the link is the key
const guidebookPageSchema = z.object({
  propertyName: z.string(), address: z.string().nullable(), wifiName: z.string(), wifiPassword: z.string(), guestCode: z.string(),
  sections: z.array(z.object({ key: z.string(), title: z.string(), text: z.string(), videoUrl: z.string(), photos: z.array(z.object({ path: z.string(), name: z.string() })) })),
});
export type GuidebookPhoto = { url: string; name: string };
export type GuidebookPage =
  | { state: 'open'; propertyName: string; address: string | null; wifiName: string; wifiPassword: string; guestCode: string;
    sections: { key: string; title: string; text: string; videoUrl: string; photos: GuidebookPhoto[] }[] }
  | { state: 'invalid' | 'unavailable' };
export const GUIDEBOOK_LINK = /^[0-9a-f]{64}$/;
// Only a submitted guidebook, and never the team's key box code (20261029500000). Photos are signed for an hour.
export async function openGuidebook(token: string | undefined): Promise<GuidebookPage> {
  if (!token || !GUIDEBOOK_LINK.test(token)) return { state: 'invalid' };
  const config = authSecurityConfiguration();
  if (!config) return { state: 'unavailable' };
  try {
    const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const result = await client.rpc('workspace_guidebook_public', { link: token });
    if (result.error) return result.error.code === 'P0002' ? { state: 'invalid' } : { state: 'unavailable' };
    const page = guidebookPageSchema.parse(result.data);
    const storage = client.storage.from(LEAD_FILES_BUCKET);
    const sections = await Promise.all(page.sections.map(async s => ({
      ...s,
      photos: (await Promise.all(s.photos.map(async x => {
        const signed = await storage.createSignedUrl(x.path, 3600);
        return signed.data?.signedUrl ? { url: signed.data.signedUrl, name: x.name } : null;
      }))).filter((x): x is GuidebookPhoto => !!x),
    })));
    return { state: 'open', ...page, sections };
  } catch { return { state: 'unavailable' }; }
}
