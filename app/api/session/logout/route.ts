import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/supabase-server";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const client = await workspaceSupabase();
  if (client) await client.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303, headers: { "Cache-Control": "private, no-store" } });
}
