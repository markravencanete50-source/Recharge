import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  addPricingOpportunity,
  addDirectBookingTouch,
  canUseOperations,
  completeDirectBooking,
  completeRelisting,
  completeWeeklyScan,
  createRoutineMaintenanceBooking,
  createWeeklyReports,
  getOperationsData,
  recordDirectBookingResponse,
  saveDirectBookingOffer,
  submitListingDailyReport,
  submitRoutineInspection,
  syncLongStayBookings,
  syncListingHealth,
  syncPricingGaps,
  updateDirectBookingInvoice,
  updateListingTicket,
  updatePricingGap,
  updatePricingNight,
  updateRoutineMaintenanceBookingStatus,
} from "@/lib/operations";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync_listing_health") }),
  z.object({ action: z.literal("sync_pricing_gaps") }),
  z.object({ action: z.literal("sync_long_stays") }),
  z.object({ action: z.literal("create_weekly_reports") }),
  z.object({ action: z.literal("complete_listing_ticket"), id: z.string().uuid(), decision: z.enum(["okay", "relist", "keep"]), responded: z.boolean(), reason: z.string().max(2000).default("") }),
  z.object({ action: z.literal("complete_relisting"), id: z.string().uuid() }),
  z.object({ action: z.literal("submit_listing_daily_report"), allVisible: z.boolean(), noNegativeReviews: z.boolean() }),
  z.object({ action: z.literal("decide_gap"), id: z.string().uuid(), decision: z.enum(["hold", "alter"]), reason: z.string().min(1).max(2000), currentPricePence: z.number().int().min(0) }),
  z.object({ action: z.literal("decide_pricing_night"), id: z.string().uuid(), decision: z.enum(["hold", "change"]), reason: z.string().min(1).max(2000), decidedRatePence: z.number().int().min(0), pricelabsUpdated: z.boolean() }),
  z.object({ action: z.literal("add_opportunity"), propertyId: z.string().min(1), kind: z.enum(["school_holiday", "event", "contractor_work"]), title: z.string().min(2).max(200), location: z.string().max(200), startDate: z.string().date(), endDate: z.string().date(), decision: z.enum(["hold", "increase"]), reason: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("complete_weekly_scan"), propertyId: z.string().min(1) }),
  z.object({ action: z.literal("save_direct_offer"), id: z.string().uuid(), offeredAmountPence: z.number().int().positive() }),
  z.object({ action: z.literal("add_direct_touch"), id: z.string().uuid(), channel: z.enum(["phone", "email", "whatsapp"]), note: z.string().max(2000).default("") }),
  z.object({ action: z.literal("record_direct_response"), id: z.string().uuid(), response: z.enum(["accepted", "rejected"]) }),
  z.object({ action: z.literal("update_direct_invoice"), id: z.string().uuid(), invoiceStatus: z.enum(["sent", "settled"]) }),
  z.object({ action: z.literal("complete_direct_booking"), id: z.string().uuid(), otaCancelled: z.boolean(), uploadedToHostaway: z.boolean() }),
  z.object({ action: z.literal("create_routine_maintenance"), propertyId: z.string().min(1), category: z.enum(["safety_inspection", "garden", "bins", "general_check", "other"]), scheduledDate: z.string().date(), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")), assignedTo: z.string().max(200).default(""), notes: z.string().max(2000).default("") }),
  z.object({ action: z.literal("update_routine_maintenance_status"), id: z.string().uuid(), status: z.enum(["booked", "complete", "cancelled"]) }),
  z.object({
    action: z.literal("submit_routine_inspection"),
    bookingId: z.string().uuid(),
    checklist: z.object({ access: z.enum(["pass", "attention", "na"]), alarms: z.enum(["pass", "attention", "na"]), heating: z.enum(["pass", "attention", "na"]), electrics: z.enum(["pass", "attention", "na"]), plumbing: z.enum(["pass", "attention", "na"]), appliances: z.enum(["pass", "attention", "na"]), cleanliness: z.enum(["pass", "attention", "na"]), garden: z.enum(["pass", "attention", "na"]), bins: z.enum(["pass", "attention", "na"]) }),
    overallCondition: z.enum(["good", "attention", "urgent"]),
    workCompleted: z.string().max(4000).default(""),
    issuesFound: z.string().max(4000).default(""),
    followUpRequired: z.boolean(),
    followUpDetails: z.string().max(4000).default(""),
  }),
]);

async function profileForRequest() {
  const user = await getChatGPTUser();
  if (!user) return null;
  return getAccessProfile(user.email, user.displayName);
}

export async function GET() {
  const profile = await profileForRequest();
  if (!profile || !canUseOperations(profile)) return NextResponse.json({ error: "Access required" }, { status: 403 });
  return NextResponse.json(await getOperationsData(profile));
}

export async function POST(request: Request) {
  const profile = await profileForRequest();
  if (!profile || profile.role === "client" || !canUseOperations(profile)) return NextResponse.json({ error: "Team access required" }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid operations update" }, { status: 400 });
  try {
    const input = parsed.data;
    if (input.action === "sync_listing_health") await syncListingHealth();
    if (input.action === "sync_pricing_gaps") await syncPricingGaps();
    if (input.action === "sync_long_stays") await syncLongStayBookings();
    if (input.action === "create_weekly_reports") await createWeeklyReports();
    if (input.action === "complete_listing_ticket") await updateListingTicket(input);
    if (input.action === "complete_relisting") await completeRelisting(input.id);
    if (input.action === "submit_listing_daily_report") await submitListingDailyReport({ ...input, actorEmail: profile.email, actorName: profile.fullName });
    if (input.action === "decide_gap") await updatePricingGap({ id: input.id, decision: input.decision, reason: input.reason, currentPricePence: input.currentPricePence });
    if (input.action === "decide_pricing_night") await updatePricingNight(input);
    if (input.action === "add_opportunity") await addPricingOpportunity(input);
    if (input.action === "complete_weekly_scan") await completeWeeklyScan({ propertyId: input.propertyId, actorEmail: profile.email, actorName: profile.fullName });
    if (input.action === "save_direct_offer") await saveDirectBookingOffer(input);
    if (input.action === "add_direct_touch") await addDirectBookingTouch({ ...input, actorEmail: profile.email, actorName: profile.fullName });
    if (input.action === "record_direct_response") await recordDirectBookingResponse(input);
    if (input.action === "update_direct_invoice") await updateDirectBookingInvoice(input);
    if (input.action === "complete_direct_booking") await completeDirectBooking(input);
    if (input.action === "create_routine_maintenance") await createRoutineMaintenanceBooking({ ...input, actorEmail: profile.email, actorName: profile.fullName });
    if (input.action === "update_routine_maintenance_status") await updateRoutineMaintenanceBookingStatus(input);
    if (input.action === "submit_routine_inspection") await submitRoutineInspection({ ...input, actorEmail: profile.email, actorName: profile.fullName });
    return NextResponse.json(await getOperationsData(profile));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
