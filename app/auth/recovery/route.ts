import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/supabase-server";
import { authSecurityConfiguration, providerIdentity, recoveryPhase, requestQuota, securityHash } from "@/lib/auth-security";
import { boundedJson, isSameOrigin, RECOVERY_COOKIE, securityHeaders } from "@/lib/auth-security-policy";

type Config = NonNullable<ReturnType<typeof authSecurityConfiguration>>;
// After the sign-in service has accepted the link, the browser holds a recovery session: record
// the recovery proof and let /update-password choose the new password.
async function recoveryProof(config: Config) {
  const identity = await providerIdentity(); if (!identity) throw new Error("Invalid recovery identity");
  const token = crypto.randomUUID(); const proofHash = await securityHash("recovery-proof", token);
  if (!await recoveryPhase({ proofHash, userId: identity.user.id, sessionId: identity.sessionId, phase: "create" })) throw new Error("Recovery unavailable");
  return (response: NextResponse) => {
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    response.cookies.set(RECOVERY_COOKIE, token, { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 900 });
    return response;
  };
}
const tooMany = (retryAfter: number) => NextResponse.json({ error: "Please wait before opening this link again" }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(retryAfter) } });

// The emailed "Forgot password" link (PKCE code).
export async function GET(request: Request) {
  const config = authSecurityConfiguration();
  if (!config || new URL(request.url).origin !== config.origin) return NextResponse.json({ error: "Recovery is awaiting configuration" }, { status: 503, headers: securityHeaders });
  try {
    const quota = await requestQuota(request, "recovery-link-ip", 20, 60);
    if (!quota.allowed) return tooMany(quota.retryAfter);
    const code = new URL(request.url).searchParams.get("code"); const client = await workspaceSupabase();
    if (!code || code.length > 2048 || !client) throw new Error("Invalid recovery link");
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    // The pinned Auth SDK returns the PKCE verifier's flow marker at runtime.
    // Its public return type omits that marker; absent or unknown values fail closed.
    if (error || (data as typeof data & { redirectType?: unknown }).redirectType !== "recovery") throw new Error("Invalid recovery link");
    const finish = await recoveryProof(config);
    return finish(NextResponse.redirect(`${config.origin}/update-password`, 303));
  } catch {
    const response = NextResponse.redirect(`${config.origin}/reset-password?expired=1`, 303);
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    return response;
  }
}

// The set-password link a super admin shares after adding someone (/auth/set-password). Only a
// recovery code is accepted, so the result is always the usual "choose a new password" step.
export async function POST(request: Request) {
  const config = authSecurityConfiguration();
  if (!config) return NextResponse.json({ error: "Recovery is awaiting configuration" }, { status: 503, headers: securityHeaders });
  if (!isSameOrigin(request, config.origin)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
  try {
    const quota = await requestQuota(request, "recovery-link-ip", 20, 60);
    if (!quota.allowed) return tooMany(quota.retryAfter);
    const body = await boundedJson(request, 1024) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const client = await workspaceSupabase();
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(token) || !client) throw new Error("Invalid link");
    const { data, error } = await client.auth.verifyOtp({ token_hash: token, type: "recovery" });
    if (error || !data.session) throw new Error("Invalid link");
    const finish = await recoveryProof(config);
    return finish(NextResponse.json({ ok: true }));
  } catch {
    return NextResponse.json({ error: "This link has expired or was already used. Ask the person who added you for a new one." }, { status: 400, headers: securityHeaders });
  }
}
