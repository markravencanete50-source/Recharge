import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUseCommunicationCentre,
  getCommunicationCentreData,
} from "@/lib/communications";
import {
  hostawayErrorMessage,
  syncHostawayConversations,
} from "@/lib/hostaway";

export async function POST() {
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

  try {
    const sync = await syncHostawayConversations();
    const data = await getCommunicationCentreData(profile);
    return NextResponse.json({ ok: true, sync, data });
  } catch (error) {
    console.error("Hostaway communication sync failed", error);
    return NextResponse.json(
      { error: hostawayErrorMessage(error) },
      { status: 502 },
    );
  }
}
