import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  hostawayPropertyErrorMessage,
  isHostawayConfigured,
  listHostawayProperties,
} from "@/lib/hostaway";
import { maintenancePermissions } from "@/lib/maintenance";
import { getPropertyDatabaseData } from "@/lib/property-database";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !maintenancePermissions(profile).stays) {
    return NextResponse.json(
      { error: "Stays maintenance access required" },
      { status: 403 },
    );
  }
  if (!isHostawayConfigured()) {
    return NextResponse.json(
      { error: "Hostaway is not connected" },
      { status: 409 },
    );
  }

  try {
    const [hostawayProperties, databaseData] = await Promise.all([
      listHostawayProperties(),
      getPropertyDatabaseData(profile),
    ]);
    const savedByListing = new Map(
      (databaseData?.properties || [])
        .filter((property) => property.hostawayListingId)
        .map((property) => [property.hostawayListingId, property]),
    );
    const properties = hostawayProperties.map((property) => {
      const saved = savedByListing.get(property.id);
      if (!saved) return property;
      return {
        ...property,
        ownerName: saved.ownerName || property.ownerName,
        ownerEmail: saved.ownerEmail || property.ownerEmail,
        ownerPhone: saved.ownerPhone || property.ownerPhone,
        accessCode: saved.accessCode || property.accessCode,
        accessInfo: saved.accessInfo || property.accessInfo,
        guidebookUrl: saved.guidebookUrl || property.guidebookUrl,
        listingLinks: saved.listingLinks.length ? saved.listingLinks : property.listingLinks,
      };
    });
    return NextResponse.json({ properties });
  } catch (error) {
    console.error("Hostaway property list failed", error);
    return NextResponse.json(
      { error: hostawayPropertyErrorMessage(error) },
      { status: 502 },
    );
  }
}
