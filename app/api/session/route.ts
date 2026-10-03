import { NextResponse } from "next/server";
import { z } from "zod";
import { workspaceSupabase } from "@/lib/supabase-server";
const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(1024) });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid sign-in details" }, { status: 400 });
  const client = await workspaceSupabase();
  if (!client) return NextResponse.json({ error: "Sign-in is not configured" }, { status: 503 });
  const { error } = await client.auth.signInWithPassword(body.data);
  return NextResponse.json(error ? { error: "Sign-in failed" } : { ok: true }, { status: error ? 401 : 200, headers: { "Cache-Control": "private, no-store" } });
}
