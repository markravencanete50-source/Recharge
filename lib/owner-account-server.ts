import type { SupabaseClient } from '@supabase/supabase-js';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { LINK_MINUTES, setPasswordLink, signInService } from './account-invite-server';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { ENQUIRY_REPLY_TO, enquiryEmailReady, enquirySender } from './integration-policy';
import { integrationSettings } from './integration-server';
import { sendEmail } from './integration-providers';
import { isNativeRequest } from './native-request-policy';
import { ownerAccountActionSchema, ownerAccountEmail, type OwnerAccountEmailKind } from './owner-account';

// Proceed makes the owner's app account (migration 20261020880000). The database decides who and claims the email; this
// file makes the sign-in (the sign-in service allows one account per email, so a retry finds the first), makes the
// one-time "choose your password" link, sends the email from ownerrelations@ and records whether it went.
type Rpc = (input: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
type Prepared = { state: 'ready'; propertyId: string; propertyName: string; email: string; name: string; userId: string | null } | { state: 'none' | 'done' | 'skipped'; reason?: string };
type Claimed = { send: true; kind: OwnerAccountEmailKind; email: string; name: string; propertyName: string; propertyId: string; attempt: number } | { send: false; emailStatus: string };
export type OwnerAccountResult = { state: 'none' | 'done' | 'skipped' | 'sent' | 'failed' | 'busy'; reason?: string } | { state: 'error'; error: { message: string; code?: string } };

async function call<T>(rpc: Rpc, input: Record<string, unknown>) {
  const result = await rpc(input);
  if (result.error) throw Object.assign(new Error(result.error.message), { database: result.error });
  return result.data as T;
}
// The steps, for the server after Proceed (key: the link's token hash) or the team (key: the property).
export async function makeOwnerAccount(rpc: Rpc, admin: SupabaseClient, origin: string, key: { tokenHash: string } | { propertyId: string; requestId: string }): Promise<OwnerAccountResult> {
  try {
    let prepared = await call<Prepared>(rpc, { action: 'prepare', ...key });
    if (prepared.state !== 'ready') return prepared;
    let created = false;
    if (!prepared.userId) {
      const made = await admin.auth.admin.createUser({ email: prepared.email, email_confirm: true, user_metadata: { full_name: prepared.name } });
      if (made.data?.user && !made.error) { created = true; prepared = { ...prepared, userId: made.data.user.id }; }
      else {
        // Made a moment ago by another try: the database now finds it.
        prepared = await call<Prepared>(rpc, { action: 'prepare', ...key });
        if (prepared.state !== 'ready') return prepared;
        if (!prepared.userId) return { state: 'error', error: { message: 'The owner account could not be made just now' } };
      }
    }
    const claimed = await call<Claimed>(rpc, { action: 'link', ...key, userId: prepared.userId, created });
    if (!claimed.send) return { state: claimed.emailStatus === 'sent' ? 'done' : claimed.emailStatus === 'skipped' ? 'skipped' : 'busy' };
    const settings = integrationSettings();
    let status: 'sent' | 'failed' = 'failed';
    if (enquiryEmailReady(settings)) {
      const link = claimed.kind === 'welcome' ? await setPasswordLink(admin, origin, claimed.email) : `${origin}/sign-in`;
      if (link) {
        const email = ownerAccountEmail({ kind: claimed.kind, name: claimed.name, propertyName: claimed.propertyName, email: claimed.email, link, reset: `${origin}/reset-password`, minutes: LINK_MINUTES });
        try {
          await sendEmail(settings, { to: claimed.email, ...email, from: enquirySender(settings), replyTo: ENQUIRY_REPLY_TO, idempotencyKey: `recharge-owner-account/${claimed.propertyId}/${claimed.attempt}` });
          status = 'sent';
        } catch { status = 'failed'; }
      }
    }
    await call(rpc, { action: 'markEmail', ...key, emailStatus: status });
    return { state: status };
  } catch (error) {
    const database = (error as { database?: { message: string; code?: string } }).database;
    return { state: 'error', error: database ?? { message: 'The owner account could not be made just now' } };
  }
}

// After the client chose Proceed on their estimate page. Never fails their answer: the team sees the result and can
// send the email again.
export async function ownerAccountAfterProceed(tokenHash: string): Promise<OwnerAccountResult> {
  try {
    const config = authSecurityConfiguration(), service = signInService();
    if (!config || !service) return { state: 'none' };
    return await makeOwnerAccount(input => service.admin.rpc('workspace_owner_account', { input }), service.admin, service.origin, { tokenHash });
  } catch { return { state: 'error', error: { message: 'The owner account could not be made just now' } }; }
}

// The team's "Send it again" (or "Make the owner's account" when they recorded Proceed for the owner).
export async function ownerAccountRoute(request: Request, native = false) {
  if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
  if (native ? !isNativeRequest(request) : !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (!['stays', 'admin', 'super_admin'].includes(session.account.role)) return businessResponse({ error: 'Onboarding access denied' }, 403);
    const quota = await requestQuota(request, 'owner-account', 20, 3600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'That’s a lot of owner emails at once. Please wait a little.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    const parsed = ownerAccountActionSchema.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) return businessResponse({ error: 'Choose the property' }, 400);
    const service = signInService();
    if (!service) return businessResponse({ error: 'Owner accounts are awaiting configuration' }, 503);
    if (!enquiryEmailReady(integrationSettings())) return businessResponse({ error: 'Email isn’t set up yet, so the owner can’t be sent their sign-in link.' }, 400);
    const result = await makeOwnerAccount(input => session.client.rpc('workspace_owner_account', { input }), service.admin, service.origin, { propertyId: parsed.data.propertyId, requestId: parsed.data.requestId });
    if (result.state === 'error') return databaseFailure(result.error);
    if (result.state === 'failed') return businessResponse({ error: 'The email could not be sent just now. Please try again in a few minutes.', data: result }, 502);
    if (result.state === 'busy') return businessResponse({ error: 'The email is being sent now. Check again in a minute.', data: result }, 409);
    return businessResponse({ ok: true, data: result });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Owner accounts are temporarily unavailable' }, 503); }
}
