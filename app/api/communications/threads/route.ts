import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUseCommunicationCentre,
  getCommunicationCentreData,
  updateCommunicationThread,
} from "@/lib/communications";

const actionSchema = z.object({
  id: z.string().min(1).max(300),
  action: z.enum(["read", "junk", "close", "reopen"]),
});

export async function PATCH(request: Request) {
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

  const parsed = actionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid conversation update" }, { status: 400 });
  }

  await updateCommunicationThread({
    ...parsed.data,
    actorEmail: profile.email,
    actorName: profile.fullName,
  });
  return NextResponse.json({ ok: true, data: await getCommunicationCentreData(profile) });
}
