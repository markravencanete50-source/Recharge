import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { getPropertyDatabaseData } from "@/lib/property-database";
import { hostawayReservationErrorMessage, isHostawayConfigured, listHostawayReservations } from "@/lib/hostaway";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile) return NextResponse.json({ error: "Client access required" }, { status: 403 });
  const propertyId = new URL(request.url).searchParams.get("propertyId") || "";
  const data = await getPropertyDatabaseData(profile);
  const property = data?.properties.find((item) => item.id === propertyId);
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (!isHostawayConfigured()) return NextResponse.json({ error: "Hostaway is not connected" }, { status: 409 });
  const listingIds = Array.from(new Set([property.hostawayListingId || "", ...property.hostawayListingIds].filter(Boolean)));
  try {
    const pages = await Promise.all(listingIds.map((id) => listHostawayReservations(id)));
    const unique = new Map(pages.flat().map((reservation) => [reservation.id, reservation]));
    return NextResponse.json({ reservations: Array.from(unique.values()) });
  } catch (error) {
    console.error("Client reservation list failed", error);
    return NextResponse.json({ error: hostawayReservationErrorMessage(error) }, { status: 502 });
  }
}
