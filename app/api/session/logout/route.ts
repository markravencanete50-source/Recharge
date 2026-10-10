import { NextResponse } from "next/server";
import { RECOVERY_COOKIE } from "@/lib/auth-security-policy";
import { workspaceSupabase } from "@/lib/supabase-server";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const client = await workspaceSupabase();
  if (client) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  const response = NextResponse.redirect(new URL("/sign-in", request.url), { status: 303, headers: { "Cache-Control": "private, no-store" } });
  // Whatever Supabase answered (it keeps the session on a network error), this browser's session
  // cookies are cleared, so signing out always signs out here.
  const names = (request.headers.get("cookie") ?? "").split(";").map(part => part.split("=")[0].trim()).filter(name => name.startsWith("sb-") || name === RECOVERY_COOKIE);
  for (const name of new Set(names)) response.cookies.set(name, "", { path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
  return response;
}
