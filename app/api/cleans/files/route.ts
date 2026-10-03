import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { canUseCleans, getCleansData, uploadCleanFile } from "@/lib/cleans";
import type { CleanFileKind } from "@/lib/cleans-types";

const KINDS: CleanFileKind[] = ["property_video", "mail_photo", "guest_evidence"];

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseCleans(profile)) return NextResponse.json({ error: "Recharge Cleans access required" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const ticketId = String(form?.get("ticketId") || "");
  const kind = String(form?.get("kind") || "") as CleanFileKind;
  const file = form?.get("file");
  if (!ticketId || !KINDS.includes(kind) || !(file instanceof File)) return NextResponse.json({ error: "Choose a valid clean evidence file" }, { status: 400 });
  try {
    await uploadCleanFile(profile, { ticketId, kind, file });
    return NextResponse.json({ ok: true, data: await getCleansData(profile) });
  } catch (error) {
    console.error("Clean evidence upload failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence upload failed" }, { status: 400 });
  }
}

