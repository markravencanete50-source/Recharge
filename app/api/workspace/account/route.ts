import { NextResponse } from "next/server";
import { securityHeaders } from "@/lib/auth-security-policy";
import { verifiedWorkspaceUser, workspaceSupabase } from "@/lib/supabase-server";
import { workspaceAccountSchema } from "@/lib/workspace-account-policy";

// The signed-in account for the app running in the browser at /workspace (web session cookies).
// It mirrors what the phone app receives when it signs in.
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { ...securityHeaders, "Cache-Control": "private, no-store", Vary: "Cookie" } });
export async function GET() {
  try {
    if (!await verifiedWorkspaceUser()) return respond({ error: "Please sign in." }, 401);
    const client = await workspaceSupabase();
    const result = await client?.rpc("workspace_account");
    const account = workspaceAccountSchema.safeParse(result?.data);
    if (!client || result?.error || !account.success) return respond({ error: "The workspace connection is temporarily unavailable" }, 503);
    return respond({ account: account.data });
  } catch {
    return respond({ error: "The workspace connection is temporarily unavailable" }, 503);
  }
}
