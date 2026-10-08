import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { businessResponse, databaseFailure } from './business-server';
import { isWorkspaceAdmin, type WorkspaceRole } from './modules';
import type { RpcContext } from './workspace-rpc-route';
import type { AdminAction } from './workspace-admin-policy';

// Adding people without an email service. The sign-in service creates the account already
// verified; the database then gives it its role and tools as the super admin who asked (so every
// usual check applies), and the reply carries a one-time link the person opens to choose their
// own password. Nobody else ever sees or sets that password.
type AddPerson = Extract<AdminAction, { action: 'addPerson' }>;
type PasswordLink = Extract<AdminAction, { action: 'passwordLink' }>;
// The sign-in service's email link lifetime (Supabase Auth, "Email OTP Expiration"), 1 hour by default.
export const LINK_MINUTES = 60;

const refuse = (error: string, status: number) => businessResponse({ error }, status);
function signInService() {
  const config = authSecurityConfiguration();
  if (!config) return null;
  return { origin: config.origin, admin: createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) };
}
async function allowed(context: RpcContext, scope: string) {
  if (context.account.role !== 'super_admin') return refuse('Only a super admin can do this', 403);
  const quota = await requestQuota(context.request, scope, 30, 3600, context.account.userId);
  if (!quota.allowed) { const r = refuse('Too many accounts at once. Please wait a little.', 429); r.headers.set('Retry-After', String(quota.retryAfter)); return r; }
  return null;
}
// The link opens a page on this site (so a chat app's link preview can't use it up) that sends the
// one-time code to /auth/recovery, which starts the usual "choose a new password" step.
async function setPasswordLink(admin: SupabaseClient, origin: string, email: string) {
  const result = await admin.auth.admin.generateLink({ type: 'recovery', email });
  const hash = result.data?.properties?.hashed_token;
  if (result.error || !hash || !/^[A-Za-z0-9_-]{16,256}$/.test(hash)) return null;
  return `${origin}/auth/set-password?token=${encodeURIComponent(hash)}`;
}
const record = (admin: SupabaseClient, userId: string, actorId: string, event: string, detail: Record<string, unknown>) =>
  admin.from('workspace_access_events').insert({ user_id: userId, actor_id: actorId, event_type: event, new_access: detail }).then(() => undefined, () => undefined);

export async function addPerson(context: RpcContext, input: AddPerson) {
  const refused = await allowed(context, 'add-person'); if (refused) return refused;
  const service = signInService(); if (!service) return refuse('Adding people is awaiting configuration', 503);
  const created = await service.admin.auth.admin.createUser({ email: input.email, email_confirm: true, user_metadata: { full_name: input.fullName } });
  const user = created.data?.user;
  if (created.error || !user) {
    const exists = created.error && (created.error.status === 422 || /already|exists|registered/i.test(created.error.message));
    return exists ? refuse('This email already has an account. Search for it in the list and open it to change their access or make a set-password link.', 409)
      : refuse('The account could not be created. Please try again.', 503);
  }
  const admin = isWorkspaceAdmin(input.role as WorkspaceRole);
  const saved = await context.client.rpc('workspace_admin_action', { input: {
    action: 'saveAccess', userId: user.id, fullName: input.fullName, role: input.role, status: 'active', modules: admin ? [] : input.modules, responsibilities: '',
  } });
  if (saved.error) {
    // The database refused the access, so the new sign-in is removed again.
    await service.admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    return databaseFailure(saved.error);
  }
  await record(service.admin, user.id, context.account.userId, 'account_created', { role: input.role });
  const link = await setPasswordLink(service.admin, service.origin, input.email);
  return businessResponse({ ok: true, data: { userId: user.id, link, minutes: LINK_MINUTES } });
}

export async function passwordLink(context: RpcContext, input: PasswordLink) {
  const refused = await allowed(context, 'password-link'); if (refused) return refused;
  if (input.userId === context.account.userId) return refuse('Use “Forgot password” for your own account.', 403);
  const service = signInService(); if (!service) return refuse('Set-password links are awaiting configuration', 503);
  const profile = await service.admin.from('workspace_profiles').select('role,status').eq('user_id', input.userId).maybeSingle();
  if (profile.error) return refuse('The workspace connection is temporarily unavailable', 503);
  if (!profile.data) return refuse('Account not found', 404);
  // Another super admin's sign-in stays theirs alone; blocked and deleted accounts get no link.
  if (profile.data.role === 'super_admin') return refuse('Super admins set their own password with “Forgot password”.', 403);
  if (profile.data.status === 'revoked') return refuse('This account is blocked. Unblock it first.', 400);
  const found = await service.admin.auth.admin.getUserById(input.userId);
  const email = found.data?.user?.email;
  if (found.error || !email) return refuse('This account has no email address, so it can’t get a link.', 400);
  const link = await setPasswordLink(service.admin, service.origin, email);
  if (!link) return refuse('The link could not be made. Please try again.', 503);
  await record(service.admin, input.userId, context.account.userId, 'password_link_created', {});
  return businessResponse({ ok: true, data: { userId: input.userId, link, minutes: LINK_MINUTES } });
}
