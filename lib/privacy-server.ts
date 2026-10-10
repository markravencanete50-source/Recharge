import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { authSecurityConfiguration, passwordDecision, requestQuota, securityHash } from './auth-security';
import { bearerToken, isNativeRequest } from './native-request-policy';
import { boundedJson, isSameOrigin, PASSWORD_RESET_REQUIRED } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure } from './business-server';
import { nativeIdentity, nativeProvider } from './native-session';
import { workspaceSupabase } from './supabase-server';
import { deleteAccountSchema, deletionSummarySchema, LAST_SUPER_ADMIN, privacyReadSchema } from './privacy-policy';

// "Download my data" and "Delete my account", for the phone app (/api/mobile/privacy), the browser
// app (/api/workspace/privacy) and the public /delete-account page (/api/session/delete-account).
// The database scopes every read to the signed-in person; deleting runs on the server only.

const refuse = (error: string, status: number, retryAfter?: number) => {
  const response = businessResponse({ error }, status);
  if (retryAfter) response.headers.set('Retry-After', String(retryAfter));
  return response;
};
const transportAllowed = (request: Request, native: boolean) =>
  native ? isNativeRequest(request) : isSameOrigin(request, authSecurityConfiguration()?.origin);

export async function privacyRead(request: Request, native = false) {
  try {
    const session = await businessContext(request, native);
    if (!session) return refuse('Sign in required', 401);
    const input = privacyReadSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!input.success) return refuse('Choose what to read', 400);
    // A full copy of someone's data is a heavy read: a few an hour is plenty.
    if (input.data.section === 'export') {
      const quota = await requestQuota(request, 'data-export-user', 5, 3600, session.account.userId);
      if (!quota.allowed) return refuse('You have downloaded your data a few times already. Please try again later.', 429, quota.retryAfter);
    }
    const result = await session.client.rpc('workspace_privacy_read', { section: input.data.section });
    return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data });
  } catch { return refuse('Your data is temporarily unavailable. Please try again later.', 503); }
}

type Check = { ok: true } | { ok: false; status: number; error: string; retryAfter?: number };
// Re-entering the password goes through the same lockout guard as signing in: five wrong
// passwords pause it for 24 hours. The check uses a separate, throwaway sign-in session.
async function confirmPassword(user: User, password: string): Promise<Check> {
  const email = user.email?.trim().toLowerCase();
  const phone = user.phone ? '+' + user.phone.replace(/^\+/, '') : '';
  const contact = email || phone;
  const client = nativeProvider();
  if (!contact || !client) return { ok: false, status: 503, error: 'Your password could not be checked. Please try again later.' };
  const subject = await securityHash('password-account', contact);
  let attempt: string | undefined = crypto.randomUUID();
  try {
    const begin = await passwordDecision('auth_server_begin_password', { subject_hash: subject, attempt_id: attempt });
    if (!begin.allowed) return { ok: false, status: 429, retryAfter: begin.retryAfter, error: begin.locked ? 'Too many incorrect passwords. Try again in 24 hours, or reset your password.' : 'Too many attempts. Please wait a moment.' };
    const result = await client.auth.signInWithPassword(email ? { email, password } : { phone, password });
    const token = result.data.session?.access_token;
    const identity = !result.error && token ? await nativeIdentity(client, token) : null;
    const same = identity?.user.id === user.id ? identity : null;
    const finish = await passwordDecision('auth_server_finish_password', { subject_hash: subject, attempt_id: attempt,
      outcome: same ? 'success' : result.error?.code === 'invalid_credentials' ? 'failure' : 'unavailable',
      user_id: same?.user.id ?? null, session_id: same?.sessionId ?? null });
    attempt = undefined;
    // The throwaway session only proves the password; it is closed whatever the outcome.
    if (token) await client.auth.signOut({ scope: 'local' }).catch(() => null);
    if (same && finish.allowed) return { ok: true };
    if (finish.locked) return { ok: false, status: 429, retryAfter: finish.retryAfter, error: 'Too many incorrect passwords. Try again in 24 hours, or reset your password.' };
    if (finish.passwordReset) return { ok: false, status: 403, error: PASSWORD_RESET_REQUIRED };
    return result.error?.code === 'invalid_credentials' ? { ok: false, status: 401, error: 'That password is not right.' } : { ok: false, status: 503, error: 'Your password could not be checked. Please try again later.' };
  } catch (failure) {
    if (attempt) await passwordDecision('auth_server_finish_password', { subject_hash: subject, attempt_id: attempt, outcome: 'unavailable' }).catch(() => null);
    throw failure;
  }
}

function serviceClient(): SupabaseClient | null {
  const config = authSecurityConfiguration();
  return config ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
}

// Removes the sign-in at the sign-in service: outright when nothing in the workspace refers to the
// person, otherwise closed (the service's own "soft delete" scrambles the email and phone and drops
// the password) so their records keep pointing at the anonymised "Deleted user" profile.
async function removeSignIn(service: SupabaseClient, userId: string, removable: boolean) {
  if (removable && !(await service.auth.admin.deleteUser(userId)).error) return 'deleted';
  return (await service.auth.admin.deleteUser(userId, true)).error ? 'failed' : 'closed';
}

export async function deleteOwnAccount(request: Request, native = false) {
  if (!transportAllowed(request, native)) return refuse('Invalid request origin', 403);
  if (request.method !== 'POST') return refuse('Method not allowed', 405);
  const service = serviceClient();
  if (!service) return refuse('Account deletion is awaiting configuration', 503);
  try {
    const session = await businessContext(request, native);
    if (!session) return refuse('Sign in required', 401);
    const quota = await requestQuota(request, 'account-deletion-user', 5, 3600, session.account.userId);
    if (!quota.allowed) return refuse('Too many attempts. Please wait before trying again.', 429, quota.retryAfter);
    const input = deleteAccountSchema.safeParse(await boundedJson(request, 2048));
    if (!input.success) return refuse(input.error.issues[0]?.message || 'Type DELETE and enter your password.', 400);
    const summary = await session.client.rpc('workspace_privacy_read', { section: 'deletion' });
    const parsed = deletionSummarySchema.safeParse(summary.data);
    if (summary.error || !parsed.success) return summary.error ? databaseFailure(summary.error) : refuse('Your account could not be checked. Please try again later.', 503);
    // Checked before the password, so a refused deletion never counts as a failed attempt.
    if (parsed.data.lastSuperAdmin) return refuse(LAST_SUPER_ADMIN, 409);
    const token = native ? bearerToken(request) : null;
    const found = native ? await session.client.auth.getUser(token!) : await session.client.auth.getUser();
    const user = found.data.user;
    if (found.error || !user || user.id !== session.account.userId) return refuse('Sign in required', 401);
    const checked = await confirmPassword(user, input.data.password);
    if (!checked.ok) return refuse(checked.error, checked.status, checked.retryAfter);
    const deleted = await service.rpc('workspace_delete_own_account', { target: user.id });
    if (deleted.error) return databaseFailure(deleted.error);
    const removable = Boolean((deleted.data as { removable?: unknown } | null)?.removable);
    const outcome = await removeSignIn(service, user.id, removable).catch(() => 'failed' as const);
    await service.rpc('workspace_account_deletion_signin', { target: user.id, outcome }).then(() => undefined, () => undefined);
    // The sessions are already gone in the database; this clears this browser's cookies too.
    if (!native) await (await workspaceSupabase())?.auth.signOut({ scope: 'local' }).catch(() => null);
    return businessResponse({ ok: true });
  } catch { return refuse('Your account could not be deleted just now. Please try again later.', 503); }
}
