import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { workspaceSupabase } from "@/lib/supabase-server";
import { authSecurityConfiguration, providerIdentity, recoveryPhase, requestQuota, securityHash } from "@/lib/auth-security";
import { boundedJson, isSameOrigin, newPasswordSchema, RECOVERY_COOKIE, securityHeaders, uuidSchema } from "@/lib/auth-security-policy";
export async function POST(request: Request) {
  const config = authSecurityConfiguration();
  if (!isSameOrigin(request, config?.origin)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
  if (!config) return NextResponse.json({ error: "Recovery is awaiting configuration" }, { status: 503, headers: securityHeaders });
  let recovery: Parameters<typeof recoveryPhase>[0] | undefined;
  try {
    const quota = await requestQuota(request, "password-update-ip", 10, 60);
    if (!quota.allowed) return NextResponse.json({ error: "Please wait before trying again" }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(quota.retryAfter) } });
    const body = newPasswordSchema.safeParse(await boundedJson(request));
    if (!body.success) return NextResponse.json({ error: "Use at least 12 characters, with a maximum of 72 UTF-8 bytes." }, { status: 400, headers: securityHeaders });
    const token = uuidSchema.safeParse((await cookies()).get(RECOVERY_COOKIE)?.value);
    const identity = await providerIdentity(); const client = await workspaceSupabase();
    if (!token.success || !identity || !client) return denied();
    recovery = { proofHash: await securityHash("recovery-proof", token.data), userId: identity.user.id, sessionId: identity.sessionId, phase: "begin", leaseId: crypto.randomUUID() };
    if (!await recoveryPhase(recovery)) return denied();
    const { error } = await client.auth.updateUser({ password: body.data.password });
    if (error) {
      await recoveryPhase({ ...recovery, phase: "release" }); recovery = undefined;
      return NextResponse.json({ error: "The password could not be updated. Use a strong, different password that meets the account's password rules." }, { status: 400, headers: securityHeaders });
    }
    const subjectHash = await securityHash("password-account", identity.user.email!.trim().toLowerCase());
    if (!await recoveryPhase({ ...recovery, phase: "complete", subjectHash })) throw new Error("Recovery completion unavailable");
    recovery = undefined;
    // The database has already revoked every approved Recharge session.
    await client.auth.signOut({ scope: "global" }).catch(() => null);
    const response = NextResponse.json({ ok: true }, { headers: securityHeaders });
    response.cookies.set(RECOVERY_COOKIE, "", { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  } catch {
    if (recovery) await recoveryPhase({ ...recovery, phase: "release" }).catch(() => false);
    return NextResponse.json({ error: "Password recovery is temporarily unavailable. Please try again later." }, { status: 503, headers: securityHeaders });
  }
}
function denied() { return NextResponse.json({ error: "This reset link has expired or is invalid. Request a new reset email." }, { status: 403, headers: securityHeaders }); }
