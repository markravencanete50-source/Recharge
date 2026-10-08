import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/supabase-server";
import { authSecurityConfiguration, requestQuota } from "@/lib/auth-security";
import { boundedJson, isSameOrigin, loginSchema, PASSWORD_RESET_REQUIRED, securityHeaders } from "@/lib/auth-security-policy";
import { passwordLogin, type PasswordLogin } from "./password-login";
export async function POST(request: Request) {
  const config = authSecurityConfiguration();
  if (!isSameOrigin(request, config?.origin)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
  if (!config) return NextResponse.json({ error: "Secure sign-in is awaiting configuration" }, { status: 503, headers: securityHeaders });
  try {
    const quota = await requestQuota(request, "password-ip", 20, 60);
    if (!quota.allowed) return limited(quota.retryAfter);
    const body = loginSchema.safeParse(await boundedJson(request));
    const client = await workspaceSupabase();
    if (!body.success || !client) return NextResponse.json({ error: "Check your sign-in details" }, { status: 400, headers: securityHeaders });
    const result = await passwordLogin(client, body.data);
    if (result.ok) return NextResponse.json({ ok: true }, { headers: securityHeaders });
    return refused(result);
  } catch {
    return NextResponse.json({ error: "Secure sign-in is temporarily unavailable. Please try again later." }, { status: 503, headers: securityHeaders });
  }
}
function refused(result: Exclude<PasswordLogin, { ok: true }>) {
  if (result.reason === "limited") return limited(result.retryAfter ?? 0, result.locked);
  if (result.reason === "passwordReset") return NextResponse.json({ error: PASSWORD_RESET_REQUIRED, passwordReset: true }, { status: 403, headers: securityHeaders });
  return result.reason === "invalid"
    ? NextResponse.json({ error: "Sign-in failed. Check your contact details and password." }, { status: 401, headers: securityHeaders })
    : NextResponse.json({ error: "Sign-in failed. Check your account verification or try again later." }, { status: 503, headers: securityHeaders });
}
function limited(seconds: number, locked = false) {
  return NextResponse.json({ error: locked ? "Too many incorrect passwords. Sign-in is blocked for 24 hours from the fifth failed attempt. You can reset your password to regain access sooner." : "Too many requests. Please wait before trying again.", locked, retryAfter: seconds }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(seconds) } });
}
