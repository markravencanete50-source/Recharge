import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfiguration } from "@/lib/supabase-server";
import { authSecurityConfiguration, requestQuota } from "@/lib/auth-security";
import { isSameOrigin, securityHeaders } from "@/lib/auth-security-policy";
import { isNativeRequest } from "@/lib/native-request-policy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const security = authSecurityConfiguration();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOrigin(request, security?.origin) && !isNativeRequest(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: securityHeaders });
    if (!security) return NextResponse.json({ error: "Security connection is awaiting configuration" }, { status: 503, headers: securityHeaders });
    try {
      const quota = await requestQuota(request, "api-ip", 120, 60);
      if (!quota.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { ...securityHeaders, "Retry-After": String(quota.retryAfter) } });
    } catch { return NextResponse.json({ error: "Security checks are temporarily unavailable" }, { status: 503, headers: securityHeaders }); }
  }
  // Private file routes supply their own sandbox and same-origin frame policy.
  // Do not replace those policies with the page-level CSP or frame prohibition.
  const responseHeaders = request.nextUrl.pathname.startsWith("/api/")
    ? Object.entries(securityHeaders).filter(([name]) => !["Content-Security-Policy", "X-Frame-Options"].includes(name))
    : Object.entries(securityHeaders);
  let response = NextResponse.next({ request });
  for (const [name, value] of responseHeaders) response.headers.set(name, value);
  response.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(self)");
  if (isNativeRequest(request)) { response.headers.set("Vary", "Authorization"); return response; }
  const config = supabaseConfiguration();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: values => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const [name, value] of responseHeaders) response.headers.set(name, value);
        response.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(self)");
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      },
    },
  });
  await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"] };
