import { NextResponse } from "next/server";
import { authSecurityConfiguration, passwordDecision, requestQuota, securityHash } from "@/lib/auth-security";
import { boundedJson, PASSWORD_RESET_REQUIRED, securityHeaders } from "@/lib/auth-security-policy";
import { isNativeRequest, nativeSessionSchema, bearerToken } from "@/lib/native-request-policy";
import { nativeProvider, nativeIdentity, nativeWorkspace } from "@/lib/native-session";
import { workspaceAccountSchema } from "@/lib/workspace-account-policy";
import { confirmedContact } from '@/lib/registration-policy';

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { ...securityHeaders, Vary: "Authorization" } });
}
function limited(retryAfter: number, locked = false) {
  const response = respond({ error: locked ? "Sign-in is blocked for 24 hours from the fifth incorrect password. You can reset your password sooner." : "Too many requests. Please wait.", locked, retryAfter }, 429);
  response.headers.set("Retry-After", String(retryAfter)); return response;
}
export async function POST(request: Request) {
  if (!isNativeRequest(request)) return respond({ error: "Invalid native request" }, 403);
  if (!authSecurityConfiguration()) return respond({ error: "Secure sign-in is awaiting configuration" }, 503);
  let subject: string | undefined, attempt: string | undefined;
  const client = nativeProvider();
  try {
    const input = nativeSessionSchema.safeParse(await boundedJson(request));
    if (!input.success || !client) return respond({ error: "Check your sign-in details" }, 400);
    const quota = await requestQuota(request, "native-session-ip", 20, 60);
    if (!quota.allowed) return limited(quota.retryAfter);
    if (input.data.action === "logout") {
      const session = await nativeWorkspace(request);
      if (!session) return respond({ error: "Sign in required" }, 401);
      // Provider revocation invalidates auth.sessions; the database guard checks it on every call.
      const result = await session.client.auth.admin.signOut(bearerToken(request)!, "local");
      if (result.error) return respond({ error: "Sign-out could not be confirmed. Please retry." }, 503);
      return respond({ ok: true });
    }
    if (input.data.action === "refresh") {
      const result = await client.auth.refreshSession({ refresh_token: input.data.refreshToken });
      if (result.error || !result.data.session) return respond({ error: "Please sign in again" }, 401);
      const token = result.data.session.access_token;
      const scoped = nativeProvider(token)!;
      const identity = await nativeIdentity(scoped, token);
      const allowed = identity ? await scoped.rpc("workspace_session_allowed") : null;
      if (!identity || allowed?.error || allowed?.data !== true) {
        await client.auth.signOut({ scope: "local" });
        return respond({ error: "Please sign in again" }, 401);
      }
      const account = await scoped.rpc("workspace_account");
      const parsedAccount = workspaceAccountSchema.safeParse(account.data);
      if (account.error || !parsedAccount.success) { await client.auth.signOut({ scope: "local" }); return respond({ error: "Workspace connection unavailable" }, 503); }
      return respond({ session: sessionPayload(result.data.session), account: parsedAccount.data });
    }
    const credentials = input.data.action === 'loginPhone' ? { phone: input.data.phone, password: input.data.password } : { email: input.data.email, password: input.data.password };
    const address = input.data.action === 'loginPhone' ? input.data.phone : input.data.email;
    subject = await securityHash("password-account", address); attempt = crypto.randomUUID();
    const begin = await passwordDecision("auth_server_begin_password", { subject_hash: subject, attempt_id: attempt });
    if (!begin.allowed) return limited(begin.retryAfter, begin.locked);
    const result = await client.auth.signInWithPassword(credentials);
    const token = result.data.session?.access_token;
    const candidate = !result.error && token ? await nativeIdentity(client, token) : null;
    const identity = candidate && confirmedContact(candidate.user, input.data.action === 'loginPhone' ? 'phone' : 'email', address) ? candidate : null;
    const decision = await passwordDecision("auth_server_finish_password", { subject_hash: subject, attempt_id: attempt,
      outcome: identity ? "success" : result.error?.code === "invalid_credentials" ? "failure" : "unavailable",
      user_id: identity?.user.id || null, session_id: identity?.sessionId || null });
    attempt = undefined;
    if (!identity || !decision.allowed || !result.data.session) {
      await client.auth.signOut({ scope: "local" });
      if (decision.locked) return limited(decision.retryAfter, true);
      if (decision.passwordReset) return respond({ error: PASSWORD_RESET_REQUIRED, passwordReset: true }, 403);
      return respond({ error: result.error?.code === "invalid_credentials" ? "Check your contact details and password." : "Verify your email or phone number, or try again later." }, result.error?.code === "invalid_credentials" ? 401 : 503);
    }
    const scoped = nativeProvider(token)!;
    // A landlord who enquired with this (verified) email gets their property on their account (migration 20261025200000).
    // Never stops the sign-in.
    await scoped.rpc("workspace_enquiry_owner_claim").then(() => undefined, () => undefined);
    const account = await scoped.rpc("workspace_account");
    const parsedAccount = workspaceAccountSchema.safeParse(account.data);
    if (account.error || !parsedAccount.success) { await client.auth.signOut({ scope: "local" }); return respond({ error: "Workspace connection unavailable" }, 503); }
    return respond({ session: sessionPayload(result.data.session), account: parsedAccount.data });
  } catch {
    if (attempt && subject) await passwordDecision("auth_server_finish_password", { subject_hash: subject, attempt_id: attempt, outcome: "unavailable" }).catch(() => null);
    await client?.auth.signOut({ scope: "local" }).catch(() => null);
    return respond({ error: "Secure sign-in is temporarily unavailable" }, 503);
  }
}
function sessionPayload(session: { access_token: string; refresh_token: string; expires_at?: number }) {
  return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at };
}
