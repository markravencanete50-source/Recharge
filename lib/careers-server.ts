import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { boundedFormData } from './bounded-form';
import { tokenHash, tokenPattern } from './client-enquiry';
import { setPasswordLink } from './account-invite-server';
import { APP_PATH } from './client-onboarding';
import {
  CV_RULE, MAX_CV_BYTES, answersProblem, applicantActionSchema, applicationSchema, cvFileType, listingSchema, type Listing,
} from './careers';

// Careers on the server (migration 20261031400000): the public careers page and application (the CV kept in a private
// bucket), the link in the "received" email that makes the applicant's account, the careers@ emails (sent every minute
// by the Worker, lib/careers-email-server.ts), the applicant's own account, and the team opening a candidate's CV.
export const CAREERS_BUCKET = 'careers-files';
const secretClient = () => {
  const config = authSecurityConfiguration();
  return config ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
};
const tooMany = (retryAfter: number, error = 'Too many tries. Please wait a few minutes.') => { const r = businessResponse({ error }, 429); r.headers.set('Retry-After', String(retryAfter || 60)); return r; };
// The public side of the database, with our own wording passed on (never internal details).
class PublicRefusal extends Error {}
async function publicRpc<T>(input: Record<string, unknown>): Promise<T> {
  const client = secretClient(); if (!client) throw new Error('unconfigured');
  const result = await client.rpc('workspace_careers_public', { input });
  if (result.error) {
    if (result.error.code === 'P0002' || result.error.code === '22023') throw new PublicRefusal(result.error.message);
    throw new Error('unavailable');
  }
  return result.data as T;
}

// ---------------------------------------------------------------- the careers page
export async function careersListings(): Promise<Listing[] | null> {
  try { return z.array(listingSchema).parse(await publicRpc({ action: 'list' })); } catch { return null; }
}
export async function careersListing(vacancyId: string): Promise<Listing | 'closed' | null> {
  if (!z.string().uuid().safeParse(vacancyId).success) return 'closed';
  try { return listingSchema.parse(await publicRpc({ action: 'form', vacancyId })); }
  catch (error) { return error instanceof PublicRefusal ? 'closed' : null; }
}

// One multipart POST: "application" (the answers as JSON) and "cv" (the file). The vacancy is checked before the file is
// stored; the CV's type is read from its first bytes; a refused application removes the stored copy again.
// Abuse: 10 applications an hour from one address and 5 a day from one email, plus the database's 500 per vacancy.
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export async function careersApplyRoute(request: Request) {
  if (!isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  const storage = secretClient()?.storage.from(CAREERS_BUCKET);
  if (!storage) return businessResponse({ error: 'Applications are not available just now. Please try again later.' }, 503);
  try {
    const quota = await requestQuota(request, 'careers-apply', 10, 3600);
    if (!quota.allowed) return tooMany(quota.retryAfter);
    const form = await boundedFormData(request, MAX_CV_BYTES + 65536);
    if (form === 'too-large') return businessResponse({ error: `Your CV is too large. ${CV_RULE}`, field: 'cv' }, 413);
    if (!form || [...form.keys()].some(k => !['application', 'cv'].includes(k) || form.getAll(k).length !== 1)) return businessResponse({ error: 'Check your application' }, 400);
    let raw: unknown; try { raw = JSON.parse(String(form.get('application') ?? '')); } catch { raw = null; }
    const parsed = applicationSchema.safeParse(raw);
    if (!parsed.success) return businessResponse({ error: parsed.error.issues[0]?.message || 'Check your application', field: parsed.error.issues[0]?.path.at(-1) ?? null }, 400);
    const input = parsed.data;
    const perEmail = await requestQuota(request, 'careers-email', 5, 86400, 'email:' + input.email.toLowerCase());
    if (!perEmail.allowed) return tooMany(perEmail.retryAfter, 'We already have several applications from this email today. Please try again tomorrow.');
    const listing = await publicRpc<unknown>({ action: 'form', vacancyId: input.vacancyId }).then(v => listingSchema.parse(v));
    const problem = answersProblem(listing.questions, input.answers);
    if (problem) return businessResponse({ error: problem.message, field: problem.id }, 400);
    const file = form.get('cv');
    if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_CV_BYTES) return businessResponse({ error: `Add your CV. ${CV_RULE}`, field: 'cv' }, 400);
    const type = cvFileType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!type) return businessResponse({ error: `Your CV must be a ${CV_RULE}`, field: 'cv' }, 400);
    const path = `applications/${input.vacancyId}/${crypto.randomUUID()}.${type.ext}`;
    const name = (file instanceof File ? file.name : 'CV').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'CV';
    const stored = await storage.upload(path, file, { contentType: type.mime, upsert: false, cacheControl: 'private, max-age=0' });
    if (stored.error) return businessResponse({ error: 'Your CV could not be saved. Please try again.' }, 503);
    try {
      // The account link is made when the "received" email goes out (runCareersEmails); this hash only fills the slot.
      await publicRpc({ action: 'apply', vacancyId: input.vacancyId, fullName: input.fullName, email: input.email, phone: input.phone,
        answers: Object.fromEntries(Object.entries(input.answers).filter(([, v]) => v.trim() !== '')), otherRoles: input.otherRoles,
        cv: { path, name, mime: type.mime, bytes: file.size }, tokenHash: await tokenHash(randomHex()) });
    } catch (error) { await storage.remove([path]).catch(() => undefined); throw error; }
    return businessResponse({ ok: true });
  } catch (error) {
    if (error instanceof PublicRefusal) return businessResponse({ error: error.message }, 400);
    return businessResponse({ error: 'Your application could not be sent just now. Please try again in a minute.' }, 503);
  }
}

// ---------------------------------------------------------------- the applicant's account link
export type AccountLinkState = { state: 'ready'; name: string; email: string; hasSignIn: boolean } | { state: 'invalid' | 'unavailable' };
const claimSchema = z.object({ email: z.string(), name: z.string(), userId: z.string().uuid().nullable(), linked: z.boolean() });
export async function openAccountLink(token: string | undefined): Promise<AccountLinkState> {
  if (!token || !tokenPattern.test(token)) return { state: 'invalid' };
  try {
    const claim = claimSchema.parse(await publicRpc({ action: 'claimAccount', tokenHash: await tokenHash(token) }));
    return { state: 'ready', name: claim.name, email: claim.email, hasSignIn: claim.userId !== null };
  } catch (error) { return error instanceof PublicRefusal ? { state: 'invalid' } : { state: 'unavailable' }; }
}
// "Create my account": a new sign-in for their email (already verified, since the link came to that inbox) and a one-time
// link to choose a password. An email that already signs in is linked to the applications and goes to sign in.
export async function careersAccountRoute(request: Request) {
  const config = authSecurityConfiguration();
  if (!isSameOrigin(request, config?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  const admin = secretClient();
  if (!config || !admin) return businessResponse({ error: 'Accounts are not available just now. Please try again later.' }, 503);
  try {
    const quota = await requestQuota(request, 'careers-account', 10, 3600);
    if (!quota.allowed) return tooMany(quota.retryAfter);
    const body = z.object({ token: z.string().regex(tokenPattern) }).strict().safeParse(await boundedJson(request, 1024));
    if (!body.success) return businessResponse({ error: 'This link is not valid' }, 400);
    const hash = await tokenHash(body.data.token);
    const claim = claimSchema.parse(await publicRpc({ action: 'claimAccount', tokenHash: hash }));
    const signIn = `${config.origin.replace(/\/$/, '')}${APP_PATH}?${new URLSearchParams({ email: claim.email })}`;
    if (claim.userId) {
      await publicRpc({ action: 'linkApplicant', tokenHash: hash, userId: claim.userId });
      return businessResponse({ ok: true, data: { url: signIn, signIn: true } });
    }
    const created = await admin.auth.admin.createUser({ email: claim.email, email_confirm: true, user_metadata: { full_name: claim.name } });
    if (created.error || !created.data?.user) return businessResponse({ error: 'Your account could not be created. Please try again.' }, 503);
    await publicRpc({ action: 'linkApplicant', tokenHash: hash, userId: created.data.user.id });
    const link = await setPasswordLink(admin, config.origin, claim.email);
    return businessResponse({ ok: true, data: link ? { url: link, signIn: false } : { url: signIn, signIn: true } });
  } catch (error) {
    if (error instanceof PublicRefusal) return businessResponse({ error: error.message }, 400);
    return businessResponse({ error: 'Your account could not be created just now. Please try again in a minute.' }, 503);
  }
}

// ---------------------------------------------------------------- the applicant's own account
// Open to a signed-in account that is still pending (an applicant's account is never made active by applying).
export async function applicantRoute(request: Request, native = false) {
  if (native ? !isNativeRequest(request) : request.method === 'POST' && !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'pending' && session.account.status !== 'active') return businessResponse({ error: 'Your access has been removed' }, 403);
    if (request.method === 'GET') {
      const result = await session.client.rpc('workspace_applicant_read');
      return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data, mode: 'live' });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    const quota = await requestQuota(request, 'careers-applicant', 30, 60, session.account.userId);
    if (!quota.allowed) return tooMany(quota.retryAfter, 'Too many updates. Please wait.');
    const input = applicantActionSchema.safeParse(await boundedJson(request, 220_000));
    if (!input.success) return businessResponse({ error: input.error.issues[0]?.message || 'Check the update' }, 400);
    const result = await session.client.rpc('workspace_applicant_action', { input: input.data });
    return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data, ok: true });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Your applications are temporarily unavailable' }, 503); }
}

// ---------------------------------------------------------------- the team: open a CV
export async function careersCvRoute(request: Request, native = false) {
  if (native && !isNativeRequest(request)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (request.method !== 'GET') return businessResponse({ error: 'Method not allowed' }, 405);
    const parsed = z.object({ candidateId: z.string().uuid() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return businessResponse({ error: 'Choose a candidate' }, 400);
    const allowed = await session.client.rpc('workspace_recruitment_can_see', { cand: parsed.data.candidateId });
    if (allowed.error) return databaseFailure(allowed.error);
    if (allowed.data !== true) return businessResponse({ error: 'Candidate not found' }, 404);
    const file = z.object({ path: z.string(), name: z.string(), mime: z.string() }).parse(await publicRpc({ action: 'cvFile', id: parsed.data.candidateId }));
    const storage = secretClient()?.storage.from(CAREERS_BUCKET);
    if (!storage) return businessResponse({ error: 'Files are awaiting configuration' }, 503);
    const signed = await storage.createSignedUrl(file.path, 600, { download: file.name });
    if (signed.error || !signed.data?.signedUrl) return businessResponse({ error: 'The CV could not be opened just now' }, 503);
    return businessResponse({ data: { url: signed.data.signedUrl, name: file.name, mime: file.mime } });
  } catch (error) {
    if (error instanceof PublicRefusal) return businessResponse({ error: error.message }, 404);
    return viewAsFailure(error) ?? businessResponse({ error: 'Files are temporarily unavailable' }, 503);
  }
}
