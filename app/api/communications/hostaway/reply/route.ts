import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUseCommunicationCentre,
  getCommunicationCentreData,
} from "@/lib/communications";
import {
  hostawayErrorMessage,
  sendHostawayReply,
} from "@/lib/hostaway";

const replySchema = z.object({
  threadId: z.string().min(1).max(300),
  body: z.string().trim().min(1).max(5000),
});

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseCommunicationCentre(profile)) {
    return NextResponse.json(
      { error: "Communication Centre access required" },
      { status: 403 },
    );
  }

  const parsed = replySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a reply before sending" }, { status: 400 });
  }

  try {
    await sendHostawayReply({
      ...parsed.data,
      actorEmail: profile.email,
      actorName: profile.fullName,
    });
    const data = await getCommunicationCentreData(profile);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("Hostaway reply failed", error);
    return NextResponse.json(
      { error: hostawayErrorMessage(error) },
      { status: 502 },
    );
  }
}
