import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  applyOnboardingAction,
  canUseOnboarding,
  createOnboardingEnquiry,
  getOnboardingData,
} from "@/lib/onboarding";

const comparableSchema = z.object({
  name: z.string().trim().min(1).max(160),
  url: z.union([z.string().trim().url().max(1000), z.literal("")]),
  adrPence: z.number().int().min(0).max(10_000_000),
});

const repairPermissionSchema = z.object({
  category: z.string().trim().min(1).max(100),
  amountPence: z.number().int().min(0).max(10_000_000),
  fullPermission: z.boolean(),
});

const listingLinkSchema = z.object({
  platform: z.enum(["Airbnb", "Booking.com", "Comfy Workers", "Direct"]),
  url: z.string().trim().url().max(1000),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_enquiry"),
    clientName: z.string().trim().max(160).optional(),
    clientEmail: z.string().trim().email().max(254).optional(),
    propertyAddress: z.string().trim().min(5).max(500),
    propertyType: z.string().trim().min(2).max(120),
    bedrooms: z.number().int().min(0).max(40),
    bathrooms: z.number().int().min(0).max(40),
  }),
  z.object({
    action: z.literal("publish_estimate"),
    id: z.string().uuid(),
    lowRatePence: z.number().int().min(100).max(10_000_000),
    mediumRatePence: z.number().int().min(100).max(10_000_000),
    highRatePence: z.number().int().min(100).max(10_000_000),
    comparables: z.array(comparableSchema).max(3),
    comments: z.string().trim().max(10_000).default(""),
  }),
  z.object({ action: z.literal("mark_estimate_viewed"), id: z.string().uuid() }),
  z.object({
    action: z.literal("client_decision"),
    id: z.string().uuid(),
    decision: z.enum(["proceed", "reviewing", "not_proceeding"]),
    feedback: z.string().trim().max(5000).default(""),
    reviewFollowUpDate: z.string().date().nullable(),
  }),
  z.object({
    action: z.literal("staff_update"),
    id: z.string().uuid(),
    note: z.string().trim().min(2).max(5000),
    nextFollowUpDate: z.string().date().nullable(),
    resolution: z.enum(["response", "continue", "archive"]),
  }),
  z.object({
    action: z.literal("sign_agreement"),
    id: z.string().uuid(),
    signedName: z.string().trim().min(2).max(160),
    responsiblePartyName: z.string().trim().min(2).max(200),
  }),
  z.object({ action: z.literal("post_chat_message"), id: z.string().uuid(), message: z.string().trim().min(1).max(5000) }),
  z.object({
    action: z.literal("submit_onboarding_form"),
    id: z.string().uuid(),
    businessName: z.string().trim().min(2).max(200),
    bankAccountName: z.string().trim().min(2).max(200),
    bankAccountNumber: z.string().trim().regex(/^\d{8}$/),
    bankSortCode: z.string().trim().regex(/^\d{2}-?\d{2}-?\d{2}$/),
    accessDate: z.string().date(),
    accessInfo: z.string().trim().min(2).max(10_000),
    utilitiesConnected: z.boolean(),
    utilityInstallDate: z.string().date().nullable(),
    prepaymentMeters: z.boolean(),
    creditSwitchDate: z.string().date().nullable(),
    broadbandConnected: z.boolean(),
    broadbandInstallDate: z.string().date().nullable(),
    hasGarden: z.boolean(),
    mailPreference: z.string().trim().min(2).max(2000),
    warrantyDetails: z.string().trim().max(5000).default(""),
    repairPermissions: z.array(repairPermissionSchema).min(1).max(20),
    furnishingChoice: z.enum(["self", "recharge"]),
    inspectionDate: z.string().date().nullable(),
    broadbandSetupByRecharge: z.boolean(),
    broadbandCreditDetails: z.string().trim().max(5000).default(""),
    prepaymentSwitchByRecharge: z.boolean(),
    licensingRequired: z.boolean(),
  }),
  z.object({
    action: z.literal("book_inspection"),
    id: z.string().uuid(),
    inspectionDate: z.string().date(),
  }),
  z.object({ action: z.literal("set_self_inspection_date"), id: z.string().uuid(), inspectionDate: z.string().date() }),
  z.object({
    action: z.literal("publish_reports"),
    id: z.string().uuid(),
    healthSafetyPercent: z.number().int().min(0).max(100),
  }),
  z.object({
    action: z.literal("purchase_order_decision"),
    id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(5000).default(""),
  }),
  z.object({ action: z.literal("quote_decision"), id: z.string().uuid(), decision: z.enum(["accept", "consider", "contest", "reject"]), reason: z.string().trim().max(5000).default(""), followUpDate: z.string().date().nullable() }),
  z.object({
    action: z.literal("invoice_status"),
    id: z.string().uuid(),
    invoice: z.enum(["onboarding", "purchase_order", "supplier"]),
    status: z.enum(["pending", "settled"]),
  }),
  z.object({
    action: z.literal("set_guest_ready_date"),
    id: z.string().uuid(),
    date: z.string().date(),
  }),
  z.object({ action: z.literal("confirm_guest_ready"), id: z.string().uuid() }),
  z.object({
    action: z.literal("publish_live"),
    id: z.string().uuid(),
    listingLinks: z.array(listingLinkSchema).length(4),
    automatedMessagesReady: z.boolean(),
    socialPostReady: z.boolean(),
    guidebookUrl: z.string().trim().url().max(1000),
  }),
]);

export async function GET() {
  const access = await authorisedProfile();
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ data: await getOnboardingData(access) });
}

export async function POST(request: Request) {
  const access = await authorisedProfile();
  if (access instanceof NextResponse) return access;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Check the onboarding details" },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.action === "create_enquiry") {
      const id = await createOnboardingEnquiry(access, parsed.data);
      return NextResponse.json({ ok: true, id, data: await getOnboardingData(access) });
    }
    await applyOnboardingAction(access, parsed.data);
    return NextResponse.json({ ok: true, data: await getOnboardingData(access) });
  } catch (error) {
    console.error("Property onboarding update failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Onboarding could not be updated" },
      { status: 400 },
    );
  }
}

async function authorisedProfile() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseOnboarding(profile)) {
    return NextResponse.json({ error: "Property onboarding access required" }, { status: 403 });
  }
  return profile;
}
