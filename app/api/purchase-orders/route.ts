import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  applyPurchaseOrderAction,
  canUsePurchaseOrders,
  createPurchaseOrder,
  getPurchaseOrderData,
} from "@/lib/purchase-orders";

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  area: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(180),
  requiredQty: z.number().int().min(0).max(500),
  inPropertyQty: z.number().int().min(0).max(500),
  estimateUnitCostPence: z.number().int().min(0).max(100_000_000),
  actualUnitCostPence: z.number().int().min(0).max(100_000_000).optional(),
  note: z.string().trim().max(1000).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

const createSchema = z.object({
  propertyName: z.string().trim().min(2).max(180),
  clientName: z.string().trim().min(2).max(160),
  clientEmail: z.string().trim().email(),
  propertyType: z.string().trim().min(2).max(80),
  bedrooms: z.number().int().min(0).max(30),
  beds: z.number().int().min(0).max(50),
  sofaBeds: z.number().int().min(0).max(20),
  bathrooms: z.number().int().min(0).max(30),
  livingRooms: z.number().int().min(0).max(20),
  guests: z.number().int().min(1).max(100),
  notes: z.string().trim().max(5000).default(""),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_ready_quote"),
    id: z.string().uuid(),
    labourEstimatePence: z.number().int().min(0).max(100_000_000),
    items: z.array(itemSchema).min(1).max(200),
  }),
  z.object({ action: z.literal("submit_management"), id: z.string().uuid() }),
  z.object({
    action: z.literal("management_decision"),
    id: z.string().uuid(),
    decision: z.enum(["approve", "request_revision"]),
    rechargeFeePence: z.number().int().min(0).max(100_000_000),
    readyInvoicePence: z.number().int().min(0).max(100_000_000),
    managementNotes: z.string().trim().max(5000),
    items: z.array(itemSchema).min(1).max(200),
  }),
  z.object({
    action: z.literal("client_decision"),
    id: z.string().uuid(),
    decision: z.enum(["accept", "reject"]),
    note: z.string().trim().max(3000),
  }),
  z.object({
    action: z.literal("accounts_update"),
    id: z.string().uuid(),
    update: z.enum([
      "client_invoice_sent",
      "client_invoice_paid",
      "ready_invoice_received",
      "ready_invoice_settled",
      "reconciliation_settled",
    ]),
  }),
  z.object({ action: z.literal("start_purchasing"), id: z.string().uuid() }),
  z.object({
    action: z.literal("save_actuals"),
    id: z.string().uuid(),
    items: z.array(itemSchema).min(1).max(200),
  }),
  z.object({ action: z.literal("submit_evidence"), id: z.string().uuid() }),
]);

export async function GET() {
  const profile = await authorisedProfile();
  if (profile instanceof NextResponse) return profile;
  return NextResponse.json({ data: await getPurchaseOrderData(profile) });
}

export async function POST(request: Request) {
  const profile = await authorisedProfile();
  if (profile instanceof NextResponse) return profile;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the property and client details" }, { status: 400 });
  }
  try {
    await createPurchaseOrder(profile, parsed.data);
    return NextResponse.json({ ok: true, data: await getPurchaseOrderData(profile) });
  } catch (error) {
    return purchaseOrderError(error);
  }
}

export async function PATCH(request: Request) {
  const profile = await authorisedProfile();
  if (profile instanceof NextResponse) return profile;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the purchase order update" }, { status: 400 });
  }
  try {
    await applyPurchaseOrderAction(profile, parsed.data);
    return NextResponse.json({ ok: true, data: await getPurchaseOrderData(profile) });
  } catch (error) {
    return purchaseOrderError(error);
  }
}

async function authorisedProfile() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUsePurchaseOrders(profile)) {
    return NextResponse.json({ error: "Purchase order access required" }, { status: 403 });
  }
  return profile;
}

function purchaseOrderError(error: unknown) {
  console.error("Purchase order action failed", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Purchase order update failed" },
    { status: 400 },
  );
}
