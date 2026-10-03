import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  hostawayReservationErrorMessage,
  isHostawayConfigured,
  listHostawayReservations,
} from "@/lib/hostaway";
import { maintenancePermissions } from "@/lib/maintenance";
import { canUseCommunicationCentre } from "@/lib/communications";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || (!maintenancePermissions(profile).stays && !canUseCommunicationCentre(profile))) {
    return NextResponse.json({ error: "Stays access required" }, { status: 403 });
  }
  if (!isHostawayConfigured()) {
    return NextResponse.json({ error: "Hostaway is not connected" }, { status: 409 });
  }

  const listingId = new URL(request.url).searchParams.get("listingId")?.trim() || "";
  if (!listingId) {
    return NextResponse.json({ error: "Select a Hostaway property first" }, { status: 400 });
  }

  try {
    return NextResponse.json({ reservations: await listHostawayReservations(listingId) });
  } catch (error) {
    console.error("Hostaway reservation list failed", error);
    return NextResponse.json(
      { error: hostawayReservationErrorMessage(error) },
      { status: 502 },
    );
  }
}
