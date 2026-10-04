import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { scopeAnalytics } from "@/lib/analytics";
import { getWorkflowData } from "@/lib/workflows";
import { getMaintenanceData } from "@/lib/maintenance";
import { getCleansData } from "@/lib/cleans";
import { getPropertyDatabaseData } from "@/lib/property-database";
import { getOnboardingData } from "@/lib/onboarding";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile) return NextResponse.json({ error: "Active workspace access required" }, { status: 403 });
  const [workflows, maintenance, cleans, properties, onboarding] = await Promise.all([
    profile.role === "client" ? Promise.resolve(undefined) : getWorkflowData(profile),
    getMaintenanceData(profile), getCleansData(profile), getPropertyDatabaseData(profile),
    profile.role === "client" ? getOnboardingData(profile) : Promise.resolve(undefined),
  ]);
  return NextResponse.json({ data: scopeAnalytics(profile, { workflows, maintenance, cleans, properties, onboarding }) }, {
    headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" },
  });
}
