import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUseOnboarding,
  getOnboardingData,
  uploadOnboardingFile,
} from "@/lib/onboarding";
import type { OnboardingFileKind } from "@/lib/onboarding-types";

const FILE_KINDS: OnboardingFileKind[] = [
  "enquiry_media",
  "management_agreement",
  "purchase_order",
  "health_safety_report",
  "room_photo",
  "supplier_invoice",
  "listing_photo",
];

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseOnboarding(profile)) {
    return NextResponse.json({ error: "Property onboarding access required" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const onboardingId = String(form?.get("onboardingId") || "");
  const kind = String(form?.get("kind") || "") as OnboardingFileKind;
  const roomLabel = String(form?.get("roomLabel") || "");
  const file = form?.get("file");
  if (!onboardingId || !FILE_KINDS.includes(kind) || !(file instanceof File)) {
    return NextResponse.json({ error: "Choose a valid onboarding file" }, { status: 400 });
  }
  try {
    await uploadOnboardingFile(profile, { onboardingId, kind, roomLabel, file });
    return NextResponse.json({ ok: true, data: await getOnboardingData(profile) });
  } catch (error) {
    console.error("Onboarding file upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "File upload failed" },
      { status: 400 },
    );
  }
}

