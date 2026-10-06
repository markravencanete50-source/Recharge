import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { isWorkspaceAdmin } from "@/lib/modules";
import { periodError, scopeAnalytics } from "@/lib/analytics";
import { analyticsCsv, analyticsFilename } from "@/lib/analytics-export";
import { getWorkflowData } from "@/lib/workflows";
import { getMaintenanceData } from "@/lib/maintenance";
import { getCleansData } from "@/lib/cleans";
import { getPropertyDatabaseData } from "@/lib/property-database";

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401, headers });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || profile.status !== "active" || !isWorkspaceAdmin(profile.role)) {
    return NextResponse.json({ error: "Active admin access required to export reports" }, { status: 403, headers });
  }
  const query = new URL(request.url).searchParams;
  const period = { from: query.get("from") || "", to: query.get("to") || "" };
  const error = periodError(period);
  if (error) return NextResponse.json({ error }, { status: 400, headers });
  const [workflows, maintenance, cleans, properties] = await Promise.all([
    getWorkflowData(profile), getMaintenanceData(profile), getCleansData(profile), getPropertyDatabaseData(profile),
  ]);
  const csv = analyticsCsv(scopeAnalytics(profile, { workflows, maintenance, cleans, properties }), period);
  return new Response(csv, { headers: { ...headers, "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": `attachment; filename="${analyticsFilename(period)}"` } });
}
