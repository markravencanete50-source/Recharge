import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUseCommunicationCentre,
  createCommunicationEscalation,
} from "@/lib/communications";

const escalationSchema = z.object({
  threadId: z.string().min(1).max(300),
  messageId: z.string().min(1).max(300),
  target: z.enum(["ready", "cleans", "direct"]),
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

  const parsed = escalationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid escalation" }, { status: 400 });
  }

  try {
    await createCommunicationEscalation({
      ...parsed.data,
      actorEmail: profile.email,
      actorName: profile.fullName,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Communication report could not be created", error);
    return NextResponse.json(
      { error: "The report could not be created. Please try again." },
      { status: 500 },
    );
  }
}
