import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfiguration } from "@/lib/supabase-server";
import { authSecurityConfiguration, requestQuota } from "@/lib/auth-security";
import { isSameOrigin, securityHeaders } from "@/lib/auth-security-policy";
import { isNativeRequest } from "@/lib/native-request-policy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const security = authSecurityConfiguration();
    // Hostaway's servers call the webhook with Basic auth and no Origin header; the route checks the credentials itself.
    // Resend's servers call theirs with a signed body and no Origin header; that route verifies the signature before reading anything.
    // The company website's server sends guest messages with its shared key; that route checks the key before reading anything.
    const serverToServer = ["/api/hostaway/webhook", "/api/resend/webhook", "/api/website/guest-messages"].includes(request.nextUrl.pathname);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !serverToServer && !isSameOrigin(request, security?.origin) && !isNativeRequest(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
    if (!security) return NextResponse.json({ error: "Security connection is awaiting configuration" }, { status: 503, headers: securityHeaders });
  }
  // The request quota and the session check below go out together, one wait instead of two on every API call; a request
  // over its quota (or with the quota check down) is still refused before anything else runs.
  const quota = request.nextUrl.pathname.startsWith("/api/") ? requestQuota(request, "api-ip", 120, 60).then(answer => answer, () => null) : null;
  const refused = async () => {
    if (!quota) return null;
    const answer = await quota;
    if (!answer) return NextResponse.json({ error: "Security checks are temporarily unavailable" }, { status: 503, headers: securityHeaders });
    return answer.allowed ? null : NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(answer.retryAfter) } });
  };
  // Private file routes supply their own sandbox and same-origin frame policy.
  // Do not replace those policies with the page-level CSP or frame prohibition.
  const responseHeaders = request.nextUrl.pathname.startsWith("/api/")
    ? Object.entries(securityHeaders).filter(([name]) => !["Content-Security-Policy", "X-Frame-Options"].includes(name))
    : Object.entries(securityHeaders);
  let response = NextResponse.next({ request });
  for (const [name, value] of responseHeaders) response.headers.set(name, value);
  response.headers.set("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self)");
  if (isNativeRequest(request)) { response.headers.set("Vary", "Authorization"); return await refused() ?? response; }
  const config = supabaseConfiguration();
  if (!config) return await refused() ?? response;
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: values => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const [name, value] of responseHeaders) response.headers.set(name, value);
        response.headers.set("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self)");
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      },
    },
  });
  const [stop] = await Promise.all([refused(), client.auth.getClaims()]);
  if (stop) return stop;
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"] };
