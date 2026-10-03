import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { updateClock } from "@/lib/my-recharge";

const clockSchema = z.object({
  action: z.enum(["clock_in", "clock_out"]),
});

export async function POST(request: Request) {
  const signedInUser = await getChatGPTUser();
  if (!signedInUser) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const profile = await getAccessProfile(
    signedInUser.email,
    signedInUser.displayName,
  );
  if (!profile || profile.role === "client") {
    return NextResponse.json({ error: "Staff access required" }, { status: 403 });
  }

  const parsed = clockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid clock action" }, { status: 400 });
  }

  try {
    const data = await updateClock(profile.email, parsed.data.action);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to update My Recharge clock", error);
    return NextResponse.json(
      { error: "Your time could not be updated. Please try again." },
      { status: 500 },
    );
  }
}
