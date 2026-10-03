import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { applyCleanAction, canUseCleans, getCleansData } from "@/lib/cleans";

const cleanActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_cleaner"), id: z.string().uuid().optional(), fullName: z.string().trim().min(2).max(160), email: z.union([z.string().trim().email(), z.literal("")]), phone: z.string().trim().max(60), notes: z.string().trim().max(2000), status: z.enum(["active", "inactive"]) }),
  z.object({ action: z.literal("save_property"), id: z.string().uuid().optional(), propertyName: z.string().trim().min(2).max(180), propertyAddress: z.string().trim().min(3).max(400), accessInstructions: z.string().trim().max(3000), clientName: z.string().trim().max(160), clientEmail: z.union([z.string().trim().email(), z.literal("")]), cleanerId: z.string().uuid().nullable(), cleanPricePence: z.number().int().min(0).max(10_000_000), status: z.enum(["active", "inactive"]) }),
  z.object({ action: z.literal("assign_property_cleaner"), propertyId: z.string().uuid(), cleanerId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("assign_cleaner"), id: z.string().uuid(), cleanerId: z.string().uuid() }),
  z.object({ action: z.literal("start_clean"), id: z.string().uuid() }),
  z.object({ action: z.literal("submit_clean"), id: z.string().uuid(), broadbandWorking: z.boolean(), heatingWorking: z.boolean(), hotWaterWorking: z.boolean(), maintenanceNotes: z.string().trim().max(5000), replenishmentNotes: z.string().trim().max(5000), mailPresent: z.boolean(), mailNotes: z.string().trim().max(2000) }),
  z.object({ action: z.literal("approve_clean"), id: z.string().uuid(), guestConfirmationNotes: z.string().trim().max(2000) }),
  z.object({ action: z.literal("mark_unsuccessful"), id: z.string().uuid(), complaintNotes: z.string().trim().min(3).max(5000), refundOrCancellation: z.boolean() }),
  z.object({ action: z.literal("add_to_invoice"), id: z.string().uuid(), invoiceWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("mail_status"), id: z.string().uuid(), status: z.enum(["reviewed", "archived"]) }),
  z.object({ action: z.literal("replenishment_status"), id: z.string().uuid(), status: z.enum(["ordered", "complete"]) }),
  z.object({ action: z.literal("close_review"), id: z.string().uuid() }),
  z.object({ action: z.literal("complete_onboarding"), id: z.string().uuid(), cleanerId: z.string().uuid(), accessInstructions: z.string().trim().min(3).max(3000), cleanPricePence: z.number().int().min(0).max(10_000_000) }),
]);

export async function GET() {
  const profile = await authorisedProfile();
  if (profile instanceof NextResponse) return profile;
  return NextResponse.json({ data: await getCleansData(profile) });
}

export async function PATCH(request: Request) {
  const profile = await authorisedProfile();
  if (profile instanceof NextResponse) return profile;
  const parsed = cleanActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the Cleans update and try again" }, { status: 400 });
  try {
    await applyCleanAction(profile, parsed.data);
    return NextResponse.json({ ok: true, data: await getCleansData(profile) });
  } catch (error) {
    console.error("Cleans update failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cleans update failed" }, { status: 400 });
  }
}

async function authorisedProfile() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseCleans(profile)) return NextResponse.json({ error: "Recharge Cleans access required" }, { status: 403 });
  return profile;
}
