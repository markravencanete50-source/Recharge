import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfiguration } from "@/lib/supabase-server";
import { authSecurityConfiguration, enquiryAllowedOrigins, requestQuota } from "@/lib/auth-security";
import { isSameOrigin, listedOrigin, securityHeaders } from "@/lib/auth-security-policy";
import { isNativeRequest } from "@/lib/native-request-policy";

export async function proxy(request: NextRequest) {
  // The public enquiry form may also be posted from the company website (ENQUIRY_ALLOWED_ORIGINS); the route checks the
  // origin again and answers with CORS headers. Refusals made here carry them too, so the website can show the error.
  const security = request.nextUrl.pathname.startsWith("/api/") ? authSecurityConfiguration() : null;
  const website = request.nextUrl.pathname === "/api/enquiry" && !isSameOrigin(request, security?.origin) ? listedOrigin(request, enquiryAllowedOrigins(), security?.origin) : null;
  const answer = (body: unknown, status: number, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...securityHeaders, ...headers, ...(website ? { "Access-Control-Allow-Origin": website, Vary: "Origin" } : {}) } });
  if (request.nextUrl.pathname.startsWith("/api/")) {
    // Hostaway's servers call the webhook with Basic auth and no Origin header; the route checks the credentials itself.
    // Resend's servers call theirs with a signed body and no Origin header; that route verifies the signature before reading anything.
    // The company website's server sends guest messages with its shared key; that route checks the key before reading anything.
    const serverToServer = ["/api/hostaway/webhook", "/api/resend/webhook", "/api/website/guest-messages"].includes(request.nextUrl.pathname);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !serverToServer && !website && !isSameOrigin(request, security?.origin) && !isNativeRequest(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
    if (!security) return answer({ error: "Security connection is awaiting configuration" }, 503);
  }
  // The request quota and the session check below go out together, one wait instead of two on every API call; a request
  // over its quota (or with the quota check down) is still refused before anything else runs.
  const quota = request.nextUrl.pathname.startsWith("/api/") ? requestQuota(request, "api-ip", 120, 60).then(decision => decision, () => null) : null;
  const refused = async () => {
    if (!quota) return null;
    const decision = await quota;
    if (!decision) return answer({ error: "Security checks are temporarily unavailable" }, 503);
    return decision.allowed ? null : answer({ error: "Too many requests" }, 429, { "Retry-After": String(decision.retryAfter) });
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
