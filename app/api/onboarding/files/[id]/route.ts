import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { canUseOnboarding, getOnboardingFile } from "@/lib/onboarding";

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
    const safeName = result.file.file_name.replace(/["\r\n]/g, "");
    return new Response(result.object.body, {
      headers: {
        "content-type": result.file.content_type,
      "content-disposition": `${result.file.content_type.startsWith("image/") || result.file.content_type.startsWith("video/") || result.file.content_type.startsWith("text/html") ? "inline" : "attachment"}; filename="${safeName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Onboarding file download failed", error);
    return NextResponse.json({ error: "File could not be downloaded" }, { status: 403 });
  }
}
