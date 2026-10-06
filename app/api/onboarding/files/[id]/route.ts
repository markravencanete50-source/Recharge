import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { canUseOnboarding, getOnboardingFile } from "@/lib/onboarding";
import { privateFileHeaders } from "@/lib/file-response";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseOnboarding(profile)) {
    return NextResponse.json({ error: "Property onboarding access required" }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    const result = await getOnboardingFile(profile, id);
    if (!result) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return new Response(result.object.body, {
      headers: privateFileHeaders(result.file.content_type, result.file.file_name),
    });
  } catch (error) {
    console.error("Onboarding file download failed", error);
    return NextResponse.json({ error: "File could not be downloaded" }, { status: 403 });
  }
}
