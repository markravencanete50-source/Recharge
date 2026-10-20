import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { MAX_TRAINING_FILE_BYTES, trainingFileType } from './training-files';
import { boundedFormData } from './bounded-form';
import { LEAD_FILE_MIMES } from './lead-policy';

// The PriceLabs report kept with a lead (External Analysis, migration 20261025300000): a PDF, a Word document or a picture
// in the private "lead-files" bucket. The same pattern as course files (lib/training-files-server.ts): only the server
// touches the bucket, the database decides who may add, remove or open a file (the team who work with enquiries), and
// opening gives a 10-minute link.
export const LEAD_BUCKET = 'lead-files';
const bucket = () => {
  const config = authSecurityConfiguration();
  if (!config) return null;
  return createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(LEAD_BUCKET);
};
const id = z.string().uuid();

export async function leadFilesRoute(request: Request, native = false) {
  if (request.method === 'POST' && (native ? !isNativeRequest(request) : !isSameOrigin(request, authSecurityConfiguration()?.origin))) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    const storage = bucket();
    if (!storage) return businessResponse({ error: 'Lead files are awaiting configuration' }, 503);
    if (request.method === 'GET') {
      const parsed = z.object({ enquiryId: id, fileId: id }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return businessResponse({ error: 'Choose a file' }, 400);
      const file = await session.client.rpc('workspace_lead_file', { target_enquiry: parsed.data.enquiryId, file: parsed.data.fileId });
      if (file.error) return databaseFailure(file.error);
      const signed = await storage.createSignedUrl(String(file.data.path), 600, String(file.data.mime).startsWith('application/vnd') ? { download: String(file.data.name) } : undefined);
      if (signed.error || !signed.data?.signedUrl) return businessResponse({ error: 'The file could not be opened just now' }, 503);
      return businessResponse({ data: { url: signed.data.signedUrl, name: file.data.name, mime: file.data.mime } });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    if (!['admin', 'super_admin', 'stays'].includes(session.account.role)) return businessResponse({ error: 'Client enquiries access required' }, 403);
    const quota = await requestQuota(request, 'lead-files-user', 20, 600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many uploads. Please wait.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    // Removing a file: the database marks it removed, then the stored copy is deleted.
    if (request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json') {
      const input = z.object({ action: z.literal('remove'), enquiryId: id, fileId: id }).strict().safeParse(await boundedJson(request, 1024));
      if (!input.success) return businessResponse({ error: 'Choose a file' }, 400);
      const removed = await session.client.rpc('workspace_lead_file_action', { input: { action: 'removeFile', enquiryId: input.data.enquiryId, fileId: input.data.fileId } });
      if (removed.error) return databaseFailure(removed.error);
      await storage.remove([String(removed.data.path)]).catch(() => undefined);
      return businessResponse({ ok: true });
    }
    const form = await boundedFormData(request, MAX_TRAINING_FILE_BYTES + 65536);
    if (form === 'too-large') return businessResponse({ error: 'Files can be up to 25 MB. For a bigger report, paste its link instead.' }, 413);
    if (!form) return businessResponse({ error: 'Choose a file to upload' }, 400);
    if ([...form.keys()].some(k => !['enquiryId', 'file'].includes(k)) || [...form.keys()].some(k => form.getAll(k).length !== 1)) return businessResponse({ error: 'Unexpected upload fields' }, 400);
    const enquiryId = id.safeParse(form.get('enquiryId')); const file = form.get('file');
    if (!enquiryId.success || !(file instanceof Blob)) return businessResponse({ error: 'Choose a lead and a file' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = (file instanceof File ? file.name : 'Report').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Report';
    const type = trainingFileType(bytes, name);
    if (!type || !(LEAD_FILE_MIMES as readonly string[]).includes(type.mime)) return businessResponse({ error: 'Upload a PDF, Word document or picture (JPG, PNG, WebP) up to 25 MB' }, 400);
    const fileId = crypto.randomUUID(), path = `leads/${enquiryId.data}/${fileId}.${type.ext}`;
    const stored = await storage.upload(path, bytes, { contentType: type.mime, upsert: false, cacheControl: 'private, max-age=0' });
    if (stored.error) return businessResponse({ error: 'The file could not be stored. Please try again.' }, 503);
    const saved = await session.client.rpc('workspace_lead_file_action', { input: { action: 'addFile', enquiryId: enquiryId.data, fileId, name, mime: type.mime, bytes: bytes.length, path } });
    if (saved.error) { await storage.remove([path]).catch(() => undefined); return databaseFailure(saved.error); }
    return businessResponse({ ok: true, data: saved.data });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Lead files are temporarily unavailable' }, 503); }
}
