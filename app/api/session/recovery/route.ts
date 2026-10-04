import { NextResponse } from "next/server";
import { z } from "zod";
import { workspaceSupabase } from "@/lib/supabase-server";
import { authSecurityConfiguration, requestQuota } from "@/lib/auth-security";
import { boundedJson, emailSchema, isSameOrigin, securityHeaders } from "@/lib/auth-security-policy";
export async function POST(request: Request) {
  const config = authSecurityConfiguration();
  if (!isSameOrigin(request, config?.origin)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
  if (!config) return NextResponse.json({ error: "Password recovery is awaiting configuration" }, { status: 503, headers: securityHeaders });
  try {
    const quota = await requestQuota(request, "recovery-ip", 5, 3600);
    if (!quota.allowed) return NextResponse.json({ error: "Please wait before requesting another reset email." }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(quota.retryAfter) } });
    const body = z.object({ email: emailSchema }).safeParse(await boundedJson(request));
    if (!body.success) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400, headers: securityHeaders });
    const accountQuota = await requestQuota(request, "recovery-account", 3, 3600, body.data.email);
    const client = await workspaceSupabase();
    if (!client) throw new Error("Recovery unavailable");
    if (accountQuota.allowed) {
      const { error } = await client.auth.resetPasswordForEmail(body.data.email, { redirectTo: `${config.origin}/auth/recovery` });
      // No account-existence signal, email, token or provider error is returned.
      if (error) console.warn("Password recovery provider did not accept the request");
    }
    return NextResponse.json({ ok: true, message: "If this email matches an account and a reset can be sent, you will receive a link. Open it in this browser within the link's validity period." }, { headers: securityHeaders });
  } catch { return NextResponse.json({ error: "Password recovery is temporarily unavailable. Please try again later." }, { status: 503, headers: securityHeaders }); }
}
