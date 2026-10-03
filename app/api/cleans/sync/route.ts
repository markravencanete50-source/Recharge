import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { canUseCleans, getCleansData, syncCleansFromHostaway } from "@/lib/cleans";

export async function POST() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseCleans(profile)) return NextResponse.json({ error: "Recharge Cleans access required" }, { status: 403 });
  try {
    await syncCleansFromHostaway(profile);
    return NextResponse.json({ ok: true, data: await getCleansData(profile) });
  } catch (error) {
    console.error("Hostaway clean sync failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Hostaway clean sync failed" }, { status: 400 });
  }
}

