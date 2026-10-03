import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { canUseStaysWorkflow, recordOnboarding } from "@/lib/workflows";

const onboardingSchema = z.object({
  propertyName: z.string().trim().min(2).max(160),
  propertyAddress: z.string().trim().max(300).default(""),
  progress: z.union([
    z.literal(25),
    z.literal(50),
    z.literal(75),
    z.literal(100),
  ]),
});

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || profile.role === "client" || !canUseStaysWorkflow(profile)) {
    return NextResponse.json(
      { error: "Property onboarding access required" },
      { status: 403 },
    );
  }

  const parsed = onboardingSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the property details and try again" },
      { status: 400 },
    );
  }

  await recordOnboarding({
    ...parsed.data,
    actorEmail: profile.email,
    actorName: profile.fullName,
  });
  return NextResponse.json({ ok: true });
}
