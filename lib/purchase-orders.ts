import { isWorkspaceAdmin } from "@/lib/modules";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import type {
  PurchaseOrderCase,
  PurchaseOrderData,
  PurchaseOrderFile,
  PurchaseOrderItem,
} from "@/lib/purchase-order-types";

type ItemInput = {
  id?: string;
  area: string;
  name: string;
  requiredQty: number;
  inPropertyQty: number;
  estimateUnitCostPence: number;
  actualUnitCostPence?: number;
  note?: string;
  position?: number;
};

export type PurchaseOrderAction =
  | { action: "save_ready_quote"; id: string; labourEstimatePence: number; items: ItemInput[] }
  | { action: "submit_management"; id: string }
  | {
      action: "management_decision";
      id: string;
      decision: "approve" | "request_revision";
      rechargeFeePence: number;
      readyInvoicePence: number;
      managementNotes: string;
      items: ItemInput[];
    }
  | { action: "client_decision"; id: string; decision: "accept" | "reject"; note: string }
  | {
      action: "accounts_update";
      id: string;
      update:
        | "client_invoice_sent"
        | "client_invoice_paid"
        | "ready_invoice_received"
        | "ready_invoice_settled"
        | "reconciliation_settled";
    }
  | { action: "start_purchasing"; id: string }
  | { action: "save_actuals"; id: string; items: ItemInput[] }
  | { action: "submit_evidence"; id: string };

export function canUsePurchaseOrders(profile: AccessProfile) {
  return (
    isWorkspaceAdmin(profile.role) ||
    profile.modules.some((id) =>
      [
        "purchase-order",
        "purchase-order-requests",
        "client-purchase-order-quotes",
        "purchase-order-invoices",
        "purchase-order-accounts",
      ].includes(id),
    )
  );
}

export async function getPurchaseOrderData(
  profile: AccessProfile,
): Promise<PurchaseOrderData> {
  if (!canUsePurchaseOrders(profile)) {
    return { available: false, role: profile.role, orders: [] };
  }
  try {
    const db = database();
    const orders =
      profile.role === "client"
        ? await db
            .prepare(
              "SELECT * FROM purchase_orders WHERE lower(client_email) = lower(?) ORDER BY updated_at DESC LIMIT 250",
            )
            .bind(profile.email)
            .all<any>()
        : await db
            .prepare("SELECT * FROM purchase_orders ORDER BY updated_at DESC LIMIT 250")
            .all<any>();
    if (!orders.results.length) {
      return { available: true, role: profile.role, orders: [] };
    }
    const ids = orders.results.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    const [items, files] = await Promise.all([
      db
        .prepare(
          `SELECT * FROM purchase_order_items WHERE order_id IN (${placeholders}) ORDER BY position, name`,
        )
        .bind(...ids)
        .all<any>(),
      db
        .prepare(
          `SELECT id, order_id, item_id, kind, file_name, content_type, size_bytes, uploaded_by_name, created_at FROM purchase_order_files WHERE order_id IN (${placeholders}) ORDER BY created_at DESC`,
        )
        .bind(...ids)
        .all<any>(),
    ]);
    const mappedFiles = files.results.map(mapFile);
    return {
      available: true,
      role: profile.role,
      orders: orders.results.map((row) => {
        const mappedItems = items.results
          .filter((item) => item.order_id === row.id)
          .map((item) => mapItem(item, mappedFiles));
        return mapOrder(row, mappedItems);
      }),
    };
  } catch (error) {
    console.error("Unable to load purchase orders", error);
    return { available: false, role: profile.role, orders: [] };
  }
}

export async function createPurchaseOrder(
  profile: AccessProfile,
  input: {
    propertyName: string;
    clientName: string;
    clientEmail: string;
    propertyType: string;
    bedrooms: number;
    beds: number;
    sofaBeds: number;
    bathrooms: number;
    livingRooms: number;
    guests: number;
    notes: string;
  },
) {
  requireRole(profile, ["admin", "stays"], "Only Stays can raise purchase order requests");
  const db = database();
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const reference = `PO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 4).toUpperCase()}`;
  const details = {
    bedrooms: cleanCount(input.bedrooms),
    beds: cleanCount(input.beds),
    sofaBeds: cleanCount(input.sofaBeds),
    bathrooms: cleanCount(input.bathrooms),
    livingRooms: cleanCount(input.livingRooms),
    guests: cleanCount(input.guests),
  };
  const items = recommendedItems(details);
  const statements = [
    db
      .prepare(
        "INSERT INTO purchase_orders (id, reference, property_name, client_name, client_email, property_type, bedrooms, beds, sofa_beds, bathrooms, living_rooms, guests, notes, status, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)",
      )
      .bind(
        id,
        reference,
        input.propertyName.trim(),
        input.clientName.trim(),
        input.clientEmail.trim().toLowerCase(),
        input.propertyType.trim() || "Flat",
        details.bedrooms,
        details.beds,
        details.sofaBeds,
        details.bathrooms,
        details.livingRooms,
        details.guests,
        input.notes.trim(),
        profile.email,
        profile.fullName,
        now,
        now,
      ),
    ...items.map((item) =>
      db
        .prepare(
          "INSERT INTO purchase_order_items (id, order_id, area, name, required_qty, in_property_qty, estimate_unit_cost_pence, actual_unit_cost_pence, note, position) VALUES (?, ?, ?, ?, ?, 0, ?, 0, '', ?)",
        )
        .bind(
          crypto.randomUUID(),
          id,
          item.area,
          item.name,
          item.requiredQty,
          item.estimateUnitCostPence,
          item.position,
        ),
    ),
  ];
  await db.batch(statements);
}

export async function applyPurchaseOrderAction(
  profile: AccessProfile,
  input: PurchaseOrderAction,
) {
  const db = database();
  const order = await loadOrder(db, input.id);
  if (!order) throw new Error("Purchase order not found");
  ensureOrderVisible(profile, order);
  const now = nowSeconds();

  if (input.action === "save_ready_quote") {
    requireRole(profile, ["admin", "ready", "stays"], "Ready access required");
    if (!["new", "ready_draft", "revision_requested"].includes(order.status)) {
      throw new Error("This quote is no longer editable by Ready");
    }
    await saveItems(db, order.id, input.items, true, false);
    await db
      .prepare(
        "UPDATE purchase_orders SET labour_estimate_pence = ?, status = 'ready_draft', updated_at = ? WHERE id = ?",
      )
      .bind(cleanMoney(input.labourEstimatePence), now, order.id)
      .run();
    return;
  }

  if (input.action === "submit_management") {
    requireRole(profile, ["admin", "ready", "stays"], "Ready access required");
    if (!["ready_draft", "revision_requested"].includes(order.status)) {
      throw new Error("Save the Ready quote before submitting it");
    }
    await db
      .prepare("UPDATE purchase_orders SET status = 'management_review', updated_at = ? WHERE id = ?")
      .bind(now, order.id)
      .run();
    return;
  }

  if (input.action === "management_decision") {
    requireRole(profile, ["admin"], "Management approval is required");
    if (order.status !== "management_review") {
      throw new Error("This order is not awaiting management approval");
    }
    await saveItems(db, order.id, input.items, true, false);
    const status = input.decision === "approve" ? "client_review" : "revision_requested";
    await db
      .prepare(
        "UPDATE purchase_orders SET recharge_fee_pence = ?, ready_invoice_pence = ?, management_notes = ?, status = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        cleanMoney(input.rechargeFeePence),
        cleanMoney(input.readyInvoicePence),
        input.managementNotes.trim(),
        status,
        now,
        order.id,
      )
      .run();
    return;
  }

  if (input.action === "client_decision") {
    if (!isWorkspaceAdmin(profile.role) && profile.role !== "client") {
      throw new Error("Client approval is required");
    }
    if (order.status !== "client_review") {
      throw new Error("This quote is not awaiting a client decision");
    }
    const accepted = input.decision === "accept";
    await db
      .prepare(
        "UPDATE purchase_orders SET status = ?, client_decision_notes = ?, client_invoice_status = ?, ready_invoice_status = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        accepted ? "client_accepted" : "client_rejected",
        input.note.trim(),
        accepted ? "to_send" : "not_created",
        accepted ? "requested" : "not_requested",
        now,
        order.id,
      )
      .run();
    return;
  }

  if (input.action === "accounts_update") {
    requireRole(profile, ["admin"], "Accounts access required");
    const expected: Record<string, boolean> = {
      client_invoice_sent: order.client_invoice_status === "to_send",
      client_invoice_paid: order.client_invoice_status === "sent",
      ready_invoice_received: order.ready_invoice_status === "requested",
      ready_invoice_settled: order.ready_invoice_status === "received",
      reconciliation_settled: order.status === "reconciliation",
    };
    if (!expected[input.update]) throw new Error("Complete the previous Accounts step first");
    const updates: Record<string, string> = {
      client_invoice_sent: "client_invoice_status = 'sent'",
      client_invoice_paid: "client_invoice_status = 'paid'",
      ready_invoice_received: "ready_invoice_status = 'received'",
      ready_invoice_settled: "ready_invoice_status = 'settled'",
      reconciliation_settled:
        "reconciliation_status = 'settled', status = 'complete'",
    };
    await db
      .prepare(`UPDATE purchase_orders SET ${updates[input.update]}, updated_at = ? WHERE id = ?`)
      .bind(now, order.id)
      .run();
    return;
  }

  if (input.action === "start_purchasing") {
    requireRole(profile, ["admin", "ready", "stays"], "Ready access required");
    if (order.status !== "client_accepted") throw new Error("Client acceptance is required");
    if (order.client_invoice_status !== "paid") {
      throw new Error("Accounts must mark the client invoice as paid first");
    }
    await db
      .prepare("UPDATE purchase_orders SET status = 'purchasing', updated_at = ? WHERE id = ?")
      .bind(now, order.id)
      .run();
    return;
  }

  if (input.action === "save_actuals") {
    requireRole(profile, ["admin", "ready", "stays"], "Ready access required");
    if (!["purchasing", "reconciliation"].includes(order.status)) {
      throw new Error("Purchasing has not started for this order");
    }
    await saveItems(db, order.id, input.items, false, true);
    await db
      .prepare("UPDATE purchase_orders SET updated_at = ? WHERE id = ?")
      .bind(now, order.id)
      .run();
    return;
  }

  if (input.action === "submit_evidence") {
    requireRole(profile, ["admin", "ready", "stays"], "Ready access required");
    if (order.status !== "purchasing") throw new Error("This order is not in purchasing");
    const data = await loadCase(db, order.id);
    const missing = data.items.filter(
      (item) =>
        Math.max(0, item.requiredQty - item.inPropertyQty) > 0 &&
        (item.actualUnitCostPence <= 0 ||
          !item.files.some((file) => file.kind === "receipt") ||
          !item.files.some((file) => file.kind === "photo")),
    );
    if (missing.length) {
      throw new Error(
        `Add the actual cost, receipt and photo for ${missing[0].name} before reconciling`,
      );
    }
    const reconciliationStatus =
      data.balancePence === 0
        ? "balanced"
        : data.balancePence > 0
          ? "ready_refund_due"
          : "ready_extra_due";
    await db
      .prepare(
        "UPDATE purchase_orders SET status = 'reconciliation', reconciliation_status = ?, updated_at = ? WHERE id = ?",
      )
      .bind(reconciliationStatus, now, order.id)
      .run();
  }
}

export async function uploadPurchaseOrderFile(
  profile: AccessProfile,
  input: {
    orderId: string;
    itemId: string;
    kind: "receipt" | "photo";
    file: File;
  },
) {
  requireRole(profile, ["admin", "ready", "stays"], "Ready access required");
  const db = database();
  const order = await loadOrder(db, input.orderId);
  if (!order) throw new Error("Purchase order not found");
  const item = await db
    .prepare("SELECT id FROM purchase_order_items WHERE id = ? AND order_id = ? LIMIT 1")
    .bind(input.itemId, input.orderId)
    .first();
  if (!item) throw new Error("Purchase item not found");
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(input.file.type)) throw new Error("Upload a JPG, PNG, WebP or PDF");
  if (input.file.size < 1 || input.file.size > 25 * 1024 * 1024) {
    throw new Error("Files must be no larger than 25 MB");
  }
  if (!env.BUCKET) throw new Error("Recharge file storage is unavailable");
  const id = crypto.randomUUID();
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "evidence";
  const objectKey = `purchase-orders/${order.id}/${input.itemId}/${id}-${safeName}`;
  await env.BUCKET.put(objectKey, await input.file.arrayBuffer(), {
    httpMetadata: { contentType: input.file.type },
  });
  try {
    await db
      .prepare(
        "INSERT INTO purchase_order_files (id, order_id, item_id, kind, object_key, file_name, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        order.id,
        input.itemId,
        input.kind,
        objectKey,
        input.file.name,
        input.file.type,
        input.file.size,
        profile.email,
        profile.fullName,
        nowSeconds(),
      )
      .run();
    await db
      .prepare("UPDATE purchase_orders SET updated_at = ? WHERE id = ?")
      .bind(nowSeconds(), order.id)
      .run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
}

export async function getPurchaseOrderFile(profile: AccessProfile, id: string) {
  const db = database();
  const row = await db
    .prepare(
      "SELECT id, order_id, item_id, kind, object_key, file_name, content_type FROM purchase_order_files WHERE id = ? LIMIT 1",
    )
    .bind(id)
    .first<any>();
  if (!row) return null;
  const order = await loadOrder(db, row.order_id);
  if (!order) return null;
  ensureOrderVisible(profile, order);
  if (!env.BUCKET) throw new Error("Recharge file storage is unavailable");
  const object = await env.BUCKET.get(row.object_key);
  return object ? { row, object } : null;
}

async function loadCase(db: NonNullable<typeof env.DB>, id: string) {
  const row = await loadOrder(db, id);
  if (!row) throw new Error("Purchase order not found");
  const [items, files] = await Promise.all([
    db.prepare("SELECT * FROM purchase_order_items WHERE order_id = ? ORDER BY position, name").bind(id).all<any>(),
    db.prepare("SELECT id, order_id, item_id, kind, file_name, content_type, size_bytes, uploaded_by_name, created_at FROM purchase_order_files WHERE order_id = ? ORDER BY created_at DESC").bind(id).all<any>(),
  ]);
  const mappedFiles = files.results.map(mapFile);
  return mapOrder(
    row,
    items.results.map((item) => mapItem(item, mappedFiles)),
  );
}

async function saveItems(
  db: NonNullable<typeof env.DB>,
  orderId: string,
  items: ItemInput[],
  allowDelete: boolean,
  actualsOnly: boolean,
) {
  const existing = await db
    .prepare("SELECT id FROM purchase_order_items WHERE order_id = ?")
    .bind(orderId)
    .all<{ id: string }>();
  const existingIds = new Set(existing.results.map((row) => row.id));
  const kept = new Set<string>();
  const statements = items
    .filter((item) => item.name.trim())
    .map((item, index) => {
      const id = item.id && existingIds.has(item.id) ? item.id : crypto.randomUUID();
      kept.add(id);
      if (existingIds.has(id)) {
        return actualsOnly
          ? db
              .prepare(
                "UPDATE purchase_order_items SET actual_unit_cost_pence = ?, note = ? WHERE id = ? AND order_id = ?",
              )
              .bind(cleanMoney(item.actualUnitCostPence || 0), (item.note || "").trim(), id, orderId)
          : db
              .prepare(
                "UPDATE purchase_order_items SET area = ?, name = ?, required_qty = ?, in_property_qty = ?, estimate_unit_cost_pence = ?, note = ?, position = ? WHERE id = ? AND order_id = ?",
              )
              .bind(
                item.area.trim() || "Other",
                item.name.trim(),
                cleanCount(item.requiredQty),
                cleanCount(item.inPropertyQty),
                cleanMoney(item.estimateUnitCostPence),
                (item.note || "").trim(),
                cleanCount(item.position ?? index),
                id,
                orderId,
              );
      }
      return db
        .prepare(
          "INSERT INTO purchase_order_items (id, order_id, area, name, required_qty, in_property_qty, estimate_unit_cost_pence, actual_unit_cost_pence, note, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          orderId,
          item.area.trim() || "Other",
          item.name.trim(),
          cleanCount(item.requiredQty),
          cleanCount(item.inPropertyQty),
          cleanMoney(item.estimateUnitCostPence),
          cleanMoney(item.actualUnitCostPence || 0),
          (item.note || "").trim(),
          cleanCount(item.position ?? index),
        );
    });
  if (allowDelete) {
    for (const id of existingIds) {
      if (!kept.has(id)) {
        statements.push(
          db.prepare("DELETE FROM purchase_order_items WHERE id = ? AND order_id = ?").bind(id, orderId),
        );
      }
    }
  }
  if (statements.length) await db.batch(statements);
}

function mapFile(row: any): PurchaseOrderFile {
  return {
    id: row.id,
    orderId: row.order_id,
    itemId: row.item_id,
    kind: row.kind,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

function mapItem(row: any, files: PurchaseOrderFile[]): PurchaseOrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    area: row.area,
    name: row.name,
    requiredQty: row.required_qty,
    inPropertyQty: row.in_property_qty,
    estimateUnitCostPence: row.estimate_unit_cost_pence,
    actualUnitCostPence: row.actual_unit_cost_pence,
    note: row.note,
    position: row.position,
    files: files.filter((file) => file.itemId === row.id),
  };
}

function mapOrder(row: any, items: PurchaseOrderItem[]): PurchaseOrderCase {
  const estimatedItemsTotalPence = items.reduce(
    (total, item) =>
      total + Math.max(0, item.requiredQty - item.inPropertyQty) * item.estimateUnitCostPence,
    0,
  );
  const actualItemsTotalPence = items.reduce(
    (total, item) =>
      total + Math.max(0, item.requiredQty - item.inPropertyQty) * item.actualUnitCostPence,
    0,
  );
  const approvedClientTotalPence =
    estimatedItemsTotalPence + row.labour_estimate_pence + row.recharge_fee_pence;
  const actualTotalPence =
    actualItemsTotalPence + row.ready_invoice_pence + row.recharge_fee_pence;
  return {
    id: row.id,
    reference: row.reference,
    propertyName: row.property_name,
    clientName: row.client_name,
    clientEmail: row.client_email,
    propertyType: row.property_type,
    bedrooms: row.bedrooms,
    beds: row.beds,
    sofaBeds: row.sofa_beds,
    bathrooms: row.bathrooms,
    livingRooms: row.living_rooms,
    guests: row.guests,
    notes: row.notes,
    status: row.status,
    labourEstimatePence: row.labour_estimate_pence,
    rechargeFeePence: row.recharge_fee_pence,
    readyInvoicePence: row.ready_invoice_pence,
    managementNotes: row.management_notes,
    clientDecisionNotes: row.client_decision_notes,
    clientInvoiceStatus: row.client_invoice_status,
    readyInvoiceStatus: row.ready_invoice_status,
    reconciliationStatus: row.reconciliation_status,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    estimatedItemsTotalPence,
    approvedClientTotalPence,
    actualItemsTotalPence,
    actualTotalPence,
    balancePence: approvedClientTotalPence - actualTotalPence,
  };
}

async function loadOrder(db: NonNullable<typeof env.DB>, id: string) {
  return db.prepare("SELECT * FROM purchase_orders WHERE id = ? LIMIT 1").bind(id).first<any>();
}

function ensureOrderVisible(profile: AccessProfile, order: any) {
  if (!canUsePurchaseOrders(profile)) throw new Error("Purchase order access required");
  if (
    profile.role === "client" &&
    order.client_email.trim().toLowerCase() !== profile.email.trim().toLowerCase()
  ) {
    throw new Error("Purchase order access required");
  }
}

function requireRole(profile: AccessProfile, roles: AccessProfile["role"][], message: string) {
  if (profile.role !== "super_admin" && !roles.includes(profile.role)) throw new Error(message);
}

function database() {
  if (!env.DB) throw new Error("Recharge purchase order database is unavailable");
  return env.DB;
}

function cleanCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function cleanMoney(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function recommendedItems(input: {
  bedrooms: number;
  beds: number;
  sofaBeds: number;
  bathrooms: number;
  livingRooms: number;
  guests: number;
}) {
  let position = 0;
  const make = (area: string, name: string, requiredQty: number, pounds: number) => ({
    area,
    name,
    requiredQty,
    estimateUnitCostPence: pounds * 100,
    position: position++,
  });
  const { bedrooms, beds, sofaBeds, bathrooms, livingRooms, guests } = input;
  return [
    make("Bedrooms & linen", "Bed frame", beds, 180),
    make("Bedrooms & linen", "Mattress", beds, 190),
    make("Bedrooms & linen", "Mattress protector", beds * 2, 18),
    make("Bedrooms & linen", "Duvet", beds * 2, 32),
    make("Bedrooms & linen", "Pillows", beds * 4, 10),
    make("Bedrooms & linen", "Bed linen set", beds * 3, 28),
    make("Bedrooms & linen", "Bedside table", bedrooms * 2, 42),
    make("Bedrooms & linen", "Bedside lamp", bedrooms * 2, 22),
    make("Bedrooms & linen", "Wardrobe / clothes rail", bedrooms, 120),
    make("Bedrooms & linen", "Chest of drawers", bedrooms, 85),
    make("Bedrooms & linen", "Curtains / blinds", bedrooms, 65),
    make("Bedrooms & linen", "Clothes hangers", bedrooms * 10, 2),
    make("Living & dining", "Sofa", livingRooms, 420),
    make("Living & dining", "Sofa bed", sofaBeds, 480),
    make("Living & dining", "Coffee table", livingRooms, 70),
    make("Living & dining", "Smart TV", livingRooms, 240),
    make("Living & dining", "TV unit", livingRooms, 80),
    make("Living & dining", "Dining table", 1, 180),
    make("Living & dining", "Dining chair", guests, 45),
    make("Living & dining", "Curtains / blinds", livingRooms, 85),
    make("Living & dining", "Floor / table lamp", livingRooms * 2, 30),
    make("Living & dining", "Rug", livingRooms, 90),
    make("Living & dining", "Wall art / mirrors", bedrooms + livingRooms, 35),
    make("Kitchen", "Fridge freezer", 1, 390),
    make("Kitchen", "Washing machine", 1, 340),
    make("Kitchen", "Microwave", 1, 75),
    make("Kitchen", "Kettle", 1, 25),
    make("Kitchen", "Toaster", 1, 28),
    make("Kitchen", "Pots & pans set", 1, 70),
    make("Kitchen", "Kitchen knife set", 1, 35),
    make("Kitchen", "Cooking utensil set", 1, 30),
    make("Kitchen", "Chopping board", 2, 12),
    make("Kitchen", "Dinner plates", guests * 2, 5),
    make("Kitchen", "Side plates", guests * 2, 4),
    make("Kitchen", "Bowls", guests * 2, 4),
    make("Kitchen", "Mugs", guests * 2, 4),
    make("Kitchen", "Drinking glasses", guests * 2, 4),
    make("Kitchen", "Wine glasses", guests, 5),
    make("Kitchen", "Cutlery place setting", guests * 2, 6),
    make("Kitchen", "Kitchen bin", 1, 35),
    make("Bathrooms", "Bath towel", guests * 2, 12),
    make("Bathrooms", "Hand towel", guests * 2, 7),
    make("Bathrooms", "Bath mat", bathrooms * 2, 10),
    make("Bathrooms", "Toilet brush", bathrooms, 8),
    make("Bathrooms", "Bathroom bin", bathrooms, 12),
    make("Bathrooms", "Shower curtain / screen", bathrooms, 28),
    make("Bathrooms", "Bathroom shelf / storage", bathrooms, 30),
    make("Safety & operations", "Smoke / heat alarm", bedrooms + livingRooms + 1, 35),
    make("Safety & operations", "Carbon monoxide alarm", 1, 28),
    make("Safety & operations", "Fire blanket", 1, 22),
    make("Safety & operations", "First aid kit", 1, 24),
    make("Safety & operations", "Iron", 1, 25),
    make("Safety & operations", "Ironing board", 1, 38),
    make("Safety & operations", "Hairdryer", bedrooms, 24),
    make("Safety & operations", "Vacuum cleaner", 1, 120),
    make("Safety & operations", "Mop & bucket", 1, 30),
    make("Safety & operations", "Clothes drying rack", 1, 28),
    make("Safety & operations", "Key safe", 1, 35),
    make("Safety & operations", "Welcome folder", 1, 18),
  ].filter((item) => item.requiredQty > 0);
}
