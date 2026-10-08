import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/supabase-server";
import { authSecurityConfiguration, passwordDecision, providerIdentity, requestQuota, securityHash } from "@/lib/auth-security";
import { boundedJson, isSameOrigin, loginSchema, loginContact, PASSWORD_RESET_REQUIRED, securityHeaders } from "@/lib/auth-security-policy";
import { confirmedContact } from '@/lib/registration-policy';
export async function POST(request: Request) {
  const config = authSecurityConfiguration();
  if (!isSameOrigin(request, config?.origin)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
  if (!config) return NextResponse.json({ error: "Secure sign-in is awaiting configuration" }, { status: 503, headers: securityHeaders });
  let subject: string | undefined; let attempt: string | undefined;
  const client = await workspaceSupabase();
  try {
    const quota = await requestQuota(request, "password-ip", 20, 60);
    if (!quota.allowed) return limited(quota.retryAfter);
    const body = loginSchema.safeParse(await boundedJson(request));
    if (!body.success || !client) return NextResponse.json({ error: "Check your sign-in details" }, { status: 400, headers: securityHeaders });
    subject = await securityHash("password-account", loginContact(body.data)); attempt = crypto.randomUUID();
    const begin = await passwordDecision("auth_server_begin_password", { subject_hash: subject, attempt_id: attempt });
    if (!begin.allowed) return limited(begin.retryAfter, begin.locked);
    const { error } = await client.auth.signInWithPassword(body.data);
    const candidate = error ? null : await providerIdentity();
    const identity = candidate && confirmedContact(candidate.user, 'phone' in body.data ? 'phone' : 'email', loginContact(body.data)) ? candidate : null;
    const finish = await passwordDecision("auth_server_finish_password", { subject_hash: subject, attempt_id: attempt,
      outcome: identity ? "success" : error?.code === "invalid_credentials" ? "failure" : "unavailable",
      user_id: identity?.user.id || null, session_id: identity?.sessionId || null });
    attempt = undefined;
    if (!identity || !finish.allowed) {
      if (identity) await client.auth.signOut({ scope: "local" });
      if (finish.locked) return limited(finish.retryAfter, true);
      if (finish.passwordReset) return NextResponse.json({ error: PASSWORD_RESET_REQUIRED, passwordReset: true }, { status: 403, headers: securityHeaders });
      return NextResponse.json({ error: error?.code === "invalid_credentials" ? "Sign-in failed. Check your contact details and password." : "Sign-in failed. Check your account verification or try again later." }, { status: error?.code === "invalid_credentials" ? 401 : 503, headers: securityHeaders });
    }
    return NextResponse.json({ ok: true }, { headers: securityHeaders });
  } catch {
    if (attempt && subject) await passwordDecision("auth_server_finish_password", { subject_hash: subject, attempt_id: attempt, outcome: "unavailable" }).catch(() => null);
    await client?.auth.signOut({ scope: "local" }).catch(() => null);
    return NextResponse.json({ error: "Secure sign-in is temporarily unavailable. Please try again later." }, { status: 503, headers: securityHeaders });
  }
}
function limited(seconds: number, locked = false) {
  return NextResponse.json({ error: locked ? "Too many incorrect passwords. Sign-in is blocked for 24 hours from the fifth failed attempt. You can reset your password to regain access sooner." : "Too many requests. Please wait before trying again.", locked, retryAfter: seconds }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(seconds) } });
}
