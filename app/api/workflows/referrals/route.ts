import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { canUseStaysWorkflow, createReferral } from "@/lib/workflows";

const referralSchema = z.object({
  type: z.enum(["maintenance", "furnishing", "inspection"]),
  propertyName: z.string().trim().min(2).max(160),
  propertyAddress: z.string().trim().max(300).default(""),
  title: z.string().trim().min(3).max(180),
  details: z.string().trim().min(3).max(3000),
  priority: z.enum(["normal", "urgent"]),
  dueDate: z.string().trim().max(10).nullable(),
});

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || profile.role === "client" || !canUseStaysWorkflow(profile)) {
    return NextResponse.json(
      { error: "Stays access required" },
      { status: 403 },
    );
  }

  const parsed = referralSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the referral details and try again" },
      { status: 400 },
    );
  }

  await createReferral({
    ...parsed.data,
    actorEmail: profile.email,
    actorName: profile.fullName,
  });
  return NextResponse.json({ ok: true });
}
