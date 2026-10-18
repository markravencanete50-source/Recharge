import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { boundedFormData } from './bounded-form';
import { DocxError, docxOutline } from './docx-text';
import { MAX_AGREEMENT_BYTES, MAX_AGREEMENT_CHARACTERS, PDF_WORDING_MESSAGE, agreementFileProblem, agreementFileType, onboardingSettingsActionSchema } from './agreement-template';

// Onboarding settings (Management centre): the contract uploaded as the agreement template, Recharge's details for the
// agreement and the "Your own costs" categories (migration 20261020870000). Admins upload a Word document or a PDF; a Word
// document's text is read here (lib/docx-text.ts, nothing in it is run) and kept by the database with the file's
// fingerprint; the file goes to the private "agreement-templates" bucket, which only the server touches. Opening a
// contract gives a 10-minute link: admins any contract, an owner only the one their own agreement was made from.
export const AGREEMENT_BUCKET = 'agreement-templates';
const bucket = () => {
  const config = authSecurityConfiguration();
  if (!config) return null;
  return createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(AGREEMENT_BUCKET);
};
const id = z.string().uuid();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const TYPE_MESSAGE = 'Upload the contract as a Word document (.docx) or a PDF, up to 5 MB';
const SIZE_MESSAGE = 'This file is larger than 5 MB. Contracts can be up to 5 MB: save a smaller copy and upload that.';

export async function onboardingSettingsRoute(request: Request, native = false) {
  if (request.method === 'POST' && (native ? !isNativeRequest(request) : !isSameOrigin(request, authSecurityConfiguration()?.origin))) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (request.method === 'GET') {
      const params = Object.fromEntries(new URL(request.url).searchParams);
      // A contract's file: ?templateId=…&propertyId=… (the property whose agreement it made; admins may leave it out).
      if ('templateId' in params) {
        const parsed = z.object({ templateId: id, propertyId: id.optional() }).strict().safeParse(params);
        if (!parsed.success) return businessResponse({ error: 'Choose the contract' }, 400);
        const file = await session.client.rpc('workspace_agreement_file', { template: parsed.data.templateId, target: parsed.data.propertyId ?? null });
        if (file.error) return databaseFailure(file.error);
        const storage = bucket();
        if (!storage) return businessResponse({ error: 'Contracts are awaiting configuration' }, 503);
        const signed = await storage.createSignedUrl(String(file.data.path), 600, { download: String(file.data.name) });
        if (signed.error || !signed.data?.signedUrl) return businessResponse({ error: 'The contract could not be opened just now' }, 503);
        return businessResponse({ data: { url: signed.data.signedUrl, name: file.data.name, mime: file.data.mime } });
      }
      if (Object.keys(params).length) return businessResponse({ error: 'Unexpected settings request' }, 400);
      const read = await session.client.rpc('workspace_onboarding_settings_read');
      return read.error ? databaseFailure(read.error) : businessResponse({ data: read.data });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    const admin = session.account.role === 'admin' || session.account.role === 'super_admin';
    // Stays may read a Word agreement's wording at the agreement step (below); everything else here is for admins.
    if (!admin && session.account.role !== 'stays') return businessResponse({ error: 'Management access required' }, 403);
    const quota = await requestQuota(request, 'onboarding-settings-user', 30, 600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many changes. Please wait.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    if (request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json') {
      if (!admin) return businessResponse({ error: 'Management access required' }, 403);
      const parsed = onboardingSettingsActionSchema.safeParse(await boundedJson(request, 8192));
      if (!parsed.success) return businessResponse({ error: parsed.error.issues[0]?.message || 'Check the settings' }, 400);
      const saved = await session.client.rpc('workspace_onboarding_settings_action', { input: parsed.data });
      return saved.error ? databaseFailure(saved.error) : businessResponse({ ok: true, data: saved.data });
    }
    // Uploading a contract: { requestId, file }. The request id names the file, so a retry never keeps a second copy.
    const form = await boundedFormData(request, MAX_AGREEMENT_BYTES + 65536);
    if (form === 'too-large') return businessResponse({ error: SIZE_MESSAGE }, 413);
    if (!form) return businessResponse({ error: 'Choose the contract to upload' }, 400);
    // Reading an agreement's wording at the agreement step: { read: '1', file }. Nothing is kept; the text comes back to
    // edit before the agreement is published (the database keeps only what is published).
    if (form.has('read')) {
      if ([...form.keys()].some(k => !['read', 'file'].includes(k)) || [...form.keys()].some(k => form.getAll(k).length !== 1) || form.get('read') !== '1') return businessResponse({ error: 'Unexpected upload fields' }, 400);
      const upload = form.get('file');
      if (!(upload instanceof Blob)) return businessResponse({ error: 'Choose the agreement to upload' }, 400);
      const bytes = new Uint8Array(await upload.arrayBuffer());
      if (bytes.length > MAX_AGREEMENT_BYTES) return businessResponse({ error: SIZE_MESSAGE }, 413);
      const type = agreementFileType(bytes);
      if (!type) return businessResponse({ error: agreementFileProblem(bytes) ?? TYPE_MESSAGE }, 400);
      if (type.kind === 'pdf') return businessResponse({ error: PDF_WORDING_MESSAGE }, 400);
      let text = '';
      try { text = await docxOutline(bytes); }
      catch (error) { return businessResponse({ error: error instanceof DocxError ? error.message : 'This Word document could not be read. Save it again as a Word Document (.docx).' }, 400); }
      if (text.trim().length < 20) return businessResponse({ error: 'No text was found in this document' }, 400);
      if (text.length > MAX_AGREEMENT_CHARACTERS) return businessResponse({ error: 'This agreement is too long. Keep it under 200,000 characters.' }, 400);
      return businessResponse({ ok: true, data: { text, format: 'outline' } });
    }
    if (!admin) return businessResponse({ error: 'Management access required' }, 403);
    if ([...form.keys()].some(k => !['requestId', 'file'].includes(k)) || [...form.keys()].some(k => form.getAll(k).length !== 1)) return businessResponse({ error: 'Unexpected upload fields' }, 400);
    const requestId = id.safeParse(form.get('requestId')), file = form.get('file');
    if (!requestId.success || !(file instanceof Blob)) return businessResponse({ error: 'Choose the contract to upload' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = agreementFileType(bytes);
    if (bytes.length > MAX_AGREEMENT_BYTES) return businessResponse({ error: SIZE_MESSAGE }, 413);
    // An old .doc or a password-protected Word document says so; anything else gets the general message.
    if (!type) return businessResponse({ error: agreementFileProblem(bytes) ?? TYPE_MESSAGE }, 400);
    let body = '';
    if (type.kind === 'docx') {
      try { body = await docxOutline(bytes); }
      catch (error) { return businessResponse({ error: error instanceof DocxError ? error.message : 'This Word document could not be read. Save it again as a Word Document (.docx).' }, 400); }
      if (body.trim().length < 20) return businessResponse({ error: 'No text was found in this document' }, 400);
    }
    const fallback = type.kind === 'pdf' ? 'Contract.pdf' : 'Contract.docx';
    const name = (file instanceof File ? file.name : fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || fallback;
    const storage = bucket();
    if (!storage) return businessResponse({ error: 'Contracts are awaiting configuration' }, 503);
    const path = `agreements/${requestId.data}.${type.kind}`;
    const stored = await storage.upload(path, bytes, { contentType: type.mime, upsert: false, cacheControl: 'private, max-age=0' });
    // Already there from an earlier try of the same upload: the database keeps that one.
    const duplicate = !!stored.error && /exist|duplicate/i.test(stored.error.message);
    if (stored.error && !duplicate) return businessResponse({ error: 'The contract could not be stored. Please try again.' }, 503);
    const saved = await session.client.rpc('workspace_onboarding_settings_action', { input: {
      action: 'addTemplate', templateId: requestId.data, kind: type.kind, fileName: name, bytes: bytes.length, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)), body,
    } });
    if (saved.error) { if (!duplicate) await storage.remove([path]).catch(() => undefined); return databaseFailure(saved.error); }
    return businessResponse({ ok: true, data: saved.data });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Onboarding settings are temporarily unavailable' }, 503); }
}
