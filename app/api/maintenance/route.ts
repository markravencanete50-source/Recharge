import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  MAINTENANCE_CATEGORIES,
  canUseMaintenance,
  createMaintenanceTicketsForProperties,
  getMaintenanceData,
  maintenancePermissions,
  saveMaintenanceThresholds,
  updateMaintenanceTicket,
} from "@/lib/maintenance";

const createSchema = z.object({
  selections: z.array(z.object({
    propertyId: z.string().trim().min(1).max(160),
    hostawayListingId: z.string().trim().max(100).default(""),
    hostawayReservationId: z.string().trim().max(100).default(""),
    guestName: z.string().trim().max(160).default(""),
    bookingReference: z.string().trim().max(100).default(""),
    reservationArrivalDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).default(""),
    reservationDepartureDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).default(""),
    reservationChannel: z.string().trim().max(100).default(""),
  })).min(1).max(50),
  category: z.enum(MAINTENANCE_CATEGORIES),
  priority: z.enum(["normal", "urgent", "emergency"]),
  summary: z.string().trim().min(3).max(180),
  details: z.string().trim().min(3).max(5000),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refer_to_ready"), id: z.string().uuid() }),
  z.object({
    action: z.literal("troubleshoot"),
    id: z.string().uuid(),
    completedItems: z.array(z.string().trim().min(1).max(100)).max(20),
    notes: z.string().trim().min(3).max(3000),
    outcome: z.enum(["resolved", "ready_required"]),
    closureReason: z.string().trim().max(1000).default(""),
  }),
  z.object({
    action: z.literal("quote"),
    id: z.string().uuid(),
    amountPence: z.number().int().min(0).max(100_000_000),
    workRequired: z.string().trim().min(3).max(5000),
    proposedRepairDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal("approval"),
    id: z.string().uuid(),
    approvalKind: z.enum(["management", "client"]),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(2000).default(""),
  }),
  z.object({
    action: z.literal("schedule"),
    id: z.string().uuid(),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    assignedEmail: z.string().trim().email(),
    assignedName: z.string().trim().min(2).max(160),
  }),
  z.object({ action: z.literal("start"), id: z.string().uuid() }),
  z.object({
    action: z.literal("complete"),
    id: z.string().uuid(),
    note: z.string().trim().max(2000).default(""),
  }),
  z.object({
    action: z.literal("final_approval"),
    id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(2000).default(""),
  }),
  z.object({
    action: z.literal("mark_paid"),
    id: z.string().uuid(),
    paymentReference: z.string().trim().min(2).max(160),
    note: z.string().trim().max(2000).default(""),
  }),
  z.object({
    action: z.literal("reconcile"),
    id: z.string().uuid(),
    invoiceReference: z.string().trim().min(2).max(160),
    note: z.string().trim().max(2000).default(""),
  }),
  z.object({
    action: z.literal("close"),
    id: z.string().uuid(),
    note: z.string().trim().min(3).max(2000),
  }),
  z.object({
    action: z.literal("note"),
    id: z.string().uuid(),
    note: z.string().trim().min(2).max(2000),
  }),
]);

const thresholdSchema = z.object({
  category: z.enum(MAINTENANCE_CATEGORIES),
  managementLimitPence: z.number().int().min(0).max(100_000_000),
  clientLimitPence: z.number().int().min(0).max(100_000_000),
});

export async function GET() {
  const access = await authorisedProfile();
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ data: await getMaintenanceData(access) });
}

export async function POST(request: Request) {
  const access = await authorisedProfile();
  if (access instanceof NextResponse) return access;
  const permissions = maintenancePermissions(access);
  if (access.role === "client" || (!permissions.stays && !permissions.ready)) {
    return NextResponse.json({ error: "Team maintenance access required" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the maintenance ticket details" }, { status: 400 });
  }
  try {
    await createMaintenanceTicketsForProperties({
      ...parsed.data,
      actorEmail: access.email,
      actorName: access.fullName,
    });
    return NextResponse.json({ ok: true, data: await getMaintenanceData(access) });
  } catch (error) {
    return maintenanceError(error);
  }
}

export async function PATCH(request: Request) {
  const access = await authorisedProfile();
  if (access instanceof NextResponse) return access;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the maintenance update" }, { status: 400 });
  }
  try {
    await updateMaintenanceTicket(access, parsed.data);
    return NextResponse.json({ ok: true, data: await getMaintenanceData(access) });
  } catch (error) {
    return maintenanceError(error);
  }
}

export async function PUT(request: Request) {
  const access = await authorisedProfile();
  if (access instanceof NextResponse) return access;
  const parsed = thresholdSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the approval limits" }, { status: 400 });
  }
  try {
    await saveMaintenanceThresholds(access, parsed.data);
    return NextResponse.json({ ok: true, data: await getMaintenanceData(access) });
  } catch (error) {
    return maintenanceError(error);
  }
}

async function authorisedProfile() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseMaintenance(profile)) {
    return NextResponse.json({ error: "Maintenance access required" }, { status: 403 });
  }
  return profile;
}

function maintenanceError(error: unknown) {
  console.error("Maintenance action failed", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Maintenance update failed" },
    { status: 400 },
  );
}
