import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/supabase-server";
import { authSecurityConfiguration, providerIdentity, recoveryPhase, requestQuota, securityHash } from "@/lib/auth-security";
import { RECOVERY_COOKIE, securityHeaders } from "@/lib/auth-security-policy";
export async function GET(request: Request) {
  const config = authSecurityConfiguration();
  if (!config || new URL(request.url).origin !== config.origin) return NextResponse.json({ error: "Recovery is awaiting configuration" }, { status: 503, headers: securityHeaders });
  try {
    const quota = await requestQuota(request, "recovery-link-ip", 20, 60);
    if (!quota.allowed) return NextResponse.json({ error: "Please wait before opening this link again" }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(quota.retryAfter) } });
    const code = new URL(request.url).searchParams.get("code"); const client = await workspaceSupabase();
    if (!code || code.length > 2048 || !client) throw new Error("Invalid recovery link");
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    // The pinned Auth SDK returns the PKCE verifier's flow marker at runtime.
    // Its public return type omits that marker; absent or unknown values fail closed.
    if (error || (data as typeof data & { redirectType?: unknown }).redirectType !== "recovery") throw new Error("Invalid recovery link");
    const identity = await providerIdentity(); if (!identity) throw new Error("Invalid recovery identity");
    const token = crypto.randomUUID(); const proofHash = await securityHash("recovery-proof", token);
    if (!await recoveryPhase({ proofHash, userId: identity.user.id, sessionId: identity.sessionId, phase: "create" })) throw new Error("Recovery unavailable");
    const response = NextResponse.redirect(`${config.origin}/update-password`, 303);
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    response.cookies.set(RECOVERY_COOKIE, token, { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 900 });
    return response;
  } catch {
    const response = NextResponse.redirect(`${config.origin}/reset-password?expired=1`, 303);
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    return response;
  }
}
